import tensorflow as tf
import cv2
import numpy as np
from collections import deque
import os

MODEL_PATH = os.path.join(os.path.dirname(__file__), '217k_relu.keras')

# Loss Function
def density_loss(
    lambda_ssim=0.2,
    lambda_count=0.05
):
    """
    Composite Density Map Loss

    Total Loss =
      MSE
      + lambda_ssim * SSIM Loss
      + lambda_count * Count Loss
    """

    def loss(y_true, y_pred):

        # -------------------------------------------------
        # 1. Pixel-wise MSE
        # -------------------------------------------------
        mse = tf.reduce_mean(
            tf.square(y_true - y_pred)
        )

        # -------------------------------------------------
        # 2. Structural Similarity Loss
        # -------------------------------------------------
        ssim = tf.image.ssim(
            tf.clip_by_value(y_true, 0., 1.),
            tf.clip_by_value(y_pred, 0., 1.),
            max_val=1.0
        )
        ssim_loss = 1.0 - tf.reduce_mean(ssim)

        # -------------------------------------------------
        # 3. Count Loss
        # Sum of density map = crowd count
        # -------------------------------------------------
        pred_count = tf.reduce_sum(y_pred, axis=[1, 2, 3])
        true_count = tf.reduce_sum(y_true, axis=[1, 2, 3])

        count_loss = tf.reduce_mean(
            tf.abs(pred_count - true_count) /
            (true_count + 1.0)
        )

        # -------------------------------------------------
        # Total Loss
        # -------------------------------------------------
        total_loss = (
            mse
            + lambda_ssim * ssim_loss
            + lambda_count * count_loss
        )

        return total_loss

    return loss

# Metrics

def pixel_mae(y_true, y_pred):
    return tf.reduce_mean(tf.abs(y_true - y_pred))


def pixel_rmse(y_true, y_pred):
    return tf.sqrt(
        tf.reduce_mean(tf.square(y_true - y_pred))
    )


def ssim_metric(y_true, y_pred):
    return tf.reduce_mean(
        tf.image.ssim(
            y_true,
            y_pred,
            max_val=1.0
        )
    )


def psnr_metric(y_true, y_pred):
    return tf.reduce_mean(
        tf.image.psnr(
            y_true,
            y_pred,
            max_val=1.0
        )
    )

def count_metric(y_true, y_pred):
    pred_count = tf.reduce_sum(y_pred, axis=[1, 2, 3])
    true_count = tf.reduce_sum(y_true, axis=[1, 2, 3])
    return tf.reduce_mean(
        tf.abs((pred_count - true_count)/(true_count+1))
    )


def make_inference_fn(model, pred_threshold, image_size):
    h, w = image_size

    @tf.function(input_signature=[
        tf.TensorSpec(shape=(1, h, w, 3), dtype=tf.float32)
    ])
    def infer(img_batch):
        pred = model(img_batch, training=False)
        pred = pred[0, ..., 0]
        pred = tf.where(pred < pred_threshold, tf.zeros_like(pred), pred)
        return pred

    return infer


class CrowdModel:
    def __init__(self, keras_model, pred_threshold=0.2, image_size=(400, 400)):
        self.image_size = image_size
        self.pred_threshold = pred_threshold
        H, W = image_size
        self.infer = make_inference_fn(keras_model, pred_threshold, image_size)
        # warm-up: compiles the graph before live frames arrive
        self.infer(tf.zeros((1, H, W, 3), dtype=tf.float32))
        # pre-allocated inference buffer — reused every frame
        self.img_batch = np.empty((1, H, W, 3), dtype=np.float32)


def load_model(model_path = MODEL_PATH, pred_threshold=0.2, image_size=(400, 400)):
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at: {model_path}")

    keras_model = tf.keras.models.load_model(
        model_path,
        custom_objects={'loss': density_loss(),
                        'pixel_mae': pixel_mae,
                        'pixel_rmse': pixel_rmse,
                        'ssim_metric': ssim_metric,
                        'psnr_metric': psnr_metric,
                        'count_metric': count_metric
                        }
    )
    print("TF crowd model loaded successfully.")
    return CrowdModel(keras_model, pred_threshold, image_size)


def estimate_density(model, frame):
    H, W = model.image_size
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_rgb = cv2.resize(frame_rgb, (W, H))
    np.multiply(frame_rgb, 1.0 / 255.0, out=model.img_batch[0])
    pred_map = model.infer(model.img_batch).numpy()
    return float(pred_map.sum())


# ---------------- Motion Analyzer ----------------
class MotionAnalyzer:
    """
    Dense optical flow between consecutive frames.
    avg_speed   : mean pixel displacement per frame (how fast crowd moves)
    chaos_score : 0.0 = everyone moving same direction, 1.0 = pure random chaos
    """
    def __init__(self):
        self.prev_gray = None

    def analyze(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (15, 15), 0)

        if self.prev_gray is None or self.prev_gray.shape != gray.shape:
            self.prev_gray = gray
            return {"avg_speed": 0.0, "chaos_score": 0.0}

        flow = cv2.calcOpticalFlowFarneback(
            self.prev_gray, gray, None,
            pyr_scale=0.5, levels=3, winsize=15,
            iterations=3, poly_n=5, poly_sigma=1.2, flags=0
        )
        self.prev_gray = gray

        magnitude, angle = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        avg_speed = float(np.mean(magnitude))

        # Circular variance: how spread out the directions are
        sin_mean = np.mean(np.sin(angle))
        cos_mean = np.mean(np.cos(angle))
        r = np.sqrt(sin_mean**2 + cos_mean**2)
        chaos_score = float(1.0 - r)

        return {
            "avg_speed":   round(avg_speed, 2),
            "chaos_score": round(chaos_score, 3)
        }


# ---------------- Risk Classifier ----------------
class RiskClassifier:
    def __init__(self, window=3,
                 density_very_high=900, density_high=750, density_medium=650,
                 rate_very_high=60,     rate_high=35,     rate_medium=15,
                 chaos_very_high=0.80,  chaos_high=0.65,  chaos_medium=0.45,
                 speed_very_high=3.5,   speed_high=2.0):
        self.buffer            = deque(maxlen=window)
        self.density_very_high = density_very_high
        self.density_high      = density_high
        self.density_medium    = density_medium
        self.rate_very_high    = rate_very_high
        self.rate_high         = rate_high
        self.rate_medium       = rate_medium
        self.chaos_very_high   = chaos_very_high
        self.chaos_high        = chaos_high
        self.chaos_medium      = chaos_medium
        self.speed_very_high   = speed_very_high
        self.speed_high        = speed_high
        self.last_smoothed     = None

    def update(self, raw_count, motion=None):
        self.buffer.append(raw_count)
        smoothed = sum(self.buffer) / len(self.buffer)

        rate = 0.0
        if self.last_smoothed is not None:
            rate = smoothed - self.last_smoothed
        self.last_smoothed = smoothed

        chaos = motion.get("chaos_score", 0.0) if motion else 0.0
        speed = motion.get("avg_speed",   0.0) if motion else 0.0

        very_high = (
            smoothed > self.density_very_high or
            rate     > self.rate_very_high    or
            (smoothed > self.density_high and chaos > self.chaos_very_high) or
            (speed   > self.speed_very_high  and chaos > self.chaos_very_high)
        )
        high = (
            smoothed > self.density_high or
            rate     > self.rate_high    or
            (smoothed > self.density_medium and chaos > self.chaos_high) or
            speed    > self.speed_high
        )
        medium = (
            smoothed > self.density_medium or
            rate     > self.rate_medium    or
            chaos    > self.chaos_medium
        )

        if very_high:
            risk = "Very High Risk"
        elif high:
            risk = "High Alert"
        elif medium:
            risk = "Medium Risk"
        else:
            risk = "No Risk"

        return {
            "density":        round(smoothed, 1),
            "rate_of_change": round(rate, 1),
            "avg_speed":      round(speed, 2),
            "chaos_score":    round(chaos, 3),
            "risk":           risk
        }
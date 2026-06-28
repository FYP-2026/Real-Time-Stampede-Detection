import tensorflow as tf
import cv2
import numpy as np
from collections import deque
import os

<<<<<<< HEAD
MODEL_PATH = os.path.join(os.path.dirname(__file__), '67_precision49_recall.keras')


def weighted_focal_loss(gamma=2.0, pos_weight=800.0):
    bce = tf.keras.losses.BinaryFocalCrossentropy(gamma=gamma)
=======
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

>>>>>>> 312470256cfbb8d8aa65ad9da1dde35d62c42f89
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
    @tf.function(input_signature=[tf.TensorSpec(shape=(1, h, w, 3), dtype=tf.float32)])
    def infer(img_batch):
        pred = model(img_batch, training=False)
        pred = pred[0, ..., 0]
        pred = tf.where(pred < pred_threshold, tf.zeros_like(pred), pred)
        return pred
    return infer


class CrowdModel:
    def __init__(self, keras_model, pred_threshold=0.2, image_size=(400, 400)):
        self.image_size  = image_size
        self.pred_threshold = pred_threshold
        H, W = image_size
        self.infer = make_inference_fn(keras_model, pred_threshold, image_size)
        self.infer(tf.zeros((1, H, W, 3), dtype=tf.float32))
        self.img_batch = np.empty((1, H, W, 3), dtype=np.float32)


def load_model(model_path=MODEL_PATH, pred_threshold=0.2, image_size=(400, 400)):
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at: {model_path}")
    keras_model = tf.keras.models.load_model(
<<<<<<< HEAD
        model_path, custom_objects={'loss': weighted_focal_loss()}
=======
        model_path,
        custom_objects={'loss': density_loss(),
                        'pixel_mae': pixel_mae,
                        'pixel_rmse': pixel_rmse,
                        'ssim_metric': ssim_metric,
                        'psnr_metric': psnr_metric,
                        'count_metric': count_metric
                        }
>>>>>>> 312470256cfbb8d8aa65ad9da1dde35d62c42f89
    )
    print("TF crowd model loaded successfully.")
    return CrowdModel(keras_model, pred_threshold, image_size)


def estimate_density(model, frame):
    """
    Returns (density_score, density_map).
    density_score = sum of heatmap pixels (raw signal for calibration)
    density_map   = 400x400 numpy array [0,1] for annotation overlay
    """
    H, W = model.image_size
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_rgb = cv2.resize(frame_rgb, (W, H))
    np.multiply(frame_rgb, 1.0 / 255.0, out=model.img_batch[0])
    pred_map = model.infer(model.img_batch).numpy()
    return float(pred_map.sum()), pred_map


# ── Motion Analyzer ───────────────────────────────────────────────────
class MotionAnalyzer:
    """
    Farneback dense optical flow.
    avg_speed   : mean pixel displacement per frame
    chaos_score : 0.0 = orderly movement, 1.0 = pure panic chaos
    """
    def __init__(self):
        self.prev_gray = None

    def analyze(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (15, 15), 0)

        if self.prev_gray is None or self.prev_gray.shape != gray.shape:
            self.prev_gray = gray
            return {"avg_speed": 0.0, "chaos_score": 0.0, "flow": None}

        flow = cv2.calcOpticalFlowFarneback(
            self.prev_gray, gray, None,
            pyr_scale=0.5, levels=3, winsize=15,
            iterations=3, poly_n=5, poly_sigma=1.2, flags=0
        )
        self.prev_gray = gray

        magnitude, angle = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        avg_speed = float(np.mean(magnitude))

        sin_mean = np.mean(np.sin(angle))
        cos_mean = np.mean(np.cos(angle))
        r = np.sqrt(sin_mean**2 + cos_mean**2)
        chaos_score = float(1.0 - r)

        return {
            "avg_speed":   round(avg_speed, 2),
            "chaos_score": round(chaos_score, 3),
            "flow":        flow
        }


# ── Risk Classifier ───────────────────────────────────────────────────
class RiskClassifier:
    """
    Fruin Level of Service crowd density classification.
    Primary signal: people/m² (density)
    Secondary escalation: chaos_score + avg_speed from optical flow

    Fruin LoS reference (Fruin, 1971 — Pedestrian Planning and Design):
      < 1.5  p/m²  → No Risk     (free movement)
      1.5–2.5 p/m² → Medium Risk (restricted movement)
      2.5–4.5 p/m² → High Alert  (dangerous congestion)
      > 4.5  p/m²  → Very High Risk (stampede risk)

    Chaos/speed act as escalation modifiers — they can push a borderline
    density into the next higher risk level but cannot skip two levels.

    Rate of change deliberately excluded: density/m² + chaos is sufficient
    and more robust than noisy frame-to-frame count differences.
    """
    def __init__(self,
                 camera_area_sqm=25.0,
                 score_to_count=0.005,
                 window=3,
                 # Fruin density thresholds (people/m²) — configurable per camera
                 density_very_high=4.5,
                 density_high=2.5,
                 density_medium=1.5,
                 # Chaos thresholds (0.0–1.0) — escalation modifiers
                 chaos_very_high=0.80,
                 chaos_high=0.65,
                 chaos_medium=0.45,
                 # Speed thresholds (px/frame) — escalation modifiers
                 speed_very_high=7.0,
                 speed_high=5.0):

        self.camera_area_sqm   = max(camera_area_sqm, 1.0)
        self.score_to_count    = score_to_count
        self.buffer            = deque(maxlen=window)
        self.density_very_high = density_very_high
        self.density_high      = density_high
        self.density_medium    = density_medium
        self.chaos_very_high   = chaos_very_high
        self.chaos_high        = chaos_high
        self.chaos_medium      = chaos_medium
        self.speed_very_high   = speed_very_high
        self.speed_high        = speed_high

    def update(self, raw_score, motion=None):
        # Convert raw heatmap sum → people/m²
        estimated_count = raw_score * self.score_to_count
        people_per_sqm  = estimated_count / self.camera_area_sqm

        # Smooth over window to reduce noise
        self.buffer.append(people_per_sqm)
        smoothed_ppm = sum(self.buffer) / len(self.buffer)

        chaos = motion.get("chaos_score", 0.0) if motion else 0.0
        speed = motion.get("avg_speed",   0.0) if motion else 0.0

        # ── Fruin LoS Classification with motion escalation ───────────
        if smoothed_ppm >= self.density_very_high:
            # Definitely Very High Risk regardless of motion
            risk = "Very High Risk"

        elif smoothed_ppm >= self.density_high:
            # High Alert base — escalate to Very High if panic motion detected
            if chaos >= self.chaos_very_high or speed >= self.speed_very_high:
                risk = "Very High Risk"
            else:
                risk = "High Alert"

        elif smoothed_ppm >= self.density_medium:
            # Medium Risk base — escalate if chaotic motion detected
            if chaos >= self.chaos_high or speed >= self.speed_high:
                risk = "High Alert"
            elif chaos >= self.chaos_medium:
                risk = "Medium Risk"
            else:
                risk = "Medium Risk"

        else:
            # Low density — still flag if extreme panic motion in the area
            if chaos >= self.chaos_very_high and speed >= self.speed_very_high:
                risk = "High Alert"   # Panic movement even in low density area
            else:
                risk = "No Risk"

        return {
            "density":     round(smoothed_ppm, 3),   # people/m² — primary metric
            "est_count":   round(estimated_count, 1),
            "raw_score":   round(raw_score, 1),
            "avg_speed":   round(speed, 2),
            "chaos_score": round(chaos, 3),
            "risk":        risk,
            "area_sqm":    self.camera_area_sqm,
        }


# ── Frame Annotator ───────────────────────────────────────────────────
_RISK_COLORS = {
    "No Risk":        (100, 220, 100),
    "Medium Risk":    (0,   200, 255),
    "High Alert":     (0,   140, 255),
    "Very High Risk": (0,   0,   255),
}

def create_annotated_frame(frame, density_map, flow, result):
    """
    Overlays:
      1. Density heatmap (jet colormap)
      2. High-density zone bounding boxes
      3. Optical flow arrows (color = speed)
      4. Info bar: people/m², est count, chaos, speed
    Returns JPEG bytes.
    """
    h, w       = frame.shape[:2]
    annotated  = frame.copy()
    risk       = result.get("risk", "No Risk")
    risk_color = _RISK_COLORS.get(risk, (255, 255, 255))

    # 1. Density heatmap overlay
    dm_resized = cv2.resize(density_map, (w, h))
    dm_norm    = cv2.normalize(dm_resized, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    heatmap    = cv2.applyColorMap(dm_norm, cv2.COLORMAP_JET)
    annotated  = cv2.addWeighted(annotated, 0.55, heatmap, 0.45, 0)

    # 2. High-density zone boxes (top 15% density regions)
    threshold  = np.percentile(dm_norm, 85)
    _, mask    = cv2.threshold(dm_norm, int(threshold), 255, cv2.THRESH_BINARY)
    kernel     = np.ones((20, 20), np.uint8)
    mask       = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in contours:
        if cv2.contourArea(contour) < 600:
            continue
        x, y, cw, ch = cv2.boundingRect(contour)
        cv2.rectangle(annotated, (x, y), (x + cw, y + ch), risk_color, 2)
        lbl = "HIGH DENSITY"
        (tw, th), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
        cv2.rectangle(annotated, (x, y - th - 6), (x + tw + 4, y), risk_color, -1)
        cv2.putText(annotated, lbl, (x + 2, y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1, cv2.LINE_AA)

    # 3. Optical flow arrows
    if flow is not None:
        step = 22
        for fy in range(step // 2, h - step // 2, step):
            for fx in range(step // 2, w - step // 2, step):
                u, v = flow[fy, fx]
                mag  = float(np.sqrt(u * u + v * v))
                if mag < 0.4:
                    continue
                scale = min(mag * 3.5, 18.0)
                ex = int(np.clip(fx + (u / max(mag, 1e-5)) * scale, 0, w - 1))
                ey = int(np.clip(fy + (v / max(mag, 1e-5)) * scale, 0, h - 1))
                if mag > 3.0:    arrow_color = (0, 0, 255)
                elif mag > 1.5:  arrow_color = (0, 140, 255)
                else:            arrow_color = (0, 220, 80)
                cv2.arrowedLine(annotated, (fx, fy), (ex, ey),
                                arrow_color, 1, tipLength=0.35)

    # 4. Info bar — shows people/m², count, chaos, speed (no rate of change)
    bar_h = 32
    cv2.rectangle(annotated, (0, h - bar_h), (w, h), (10, 10, 10), -1)

    pill = f" {risk} "
    (pw, _), _ = cv2.getTextSize(pill, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)
    cv2.rectangle(annotated, (4, h - bar_h + 4), (4 + pw + 4, h - 5), risk_color, -1)
    cv2.putText(annotated, pill, (6, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1, cv2.LINE_AA)

    ppm   = result.get("density",     0.0)
    count = result.get("est_count",   0.0)
    area  = result.get("area_sqm",    0.0)
    chaos = result.get("chaos_score", 0.0)
    speed = result.get("avg_speed",   0.0)

    stats = (f"  {ppm:.2f} p/m²  |  ~{count:.0f} people  |  "
             f"{area:.0f}m²  |  chaos: {chaos:.2f}  |  speed: {speed:.1f}px/f")
    cv2.putText(annotated, stats, (pw + 12, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.33, (200, 200, 200), 1, cv2.LINE_AA)

    _, jpeg = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return jpeg.tobytes()
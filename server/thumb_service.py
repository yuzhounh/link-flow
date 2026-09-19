import os
import logging
from typing import Optional
from PIL import Image

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

logger = logging.getLogger(__name__)

THUMB_SIZE = (400, 400)

def generate_thumbnail(file_path: str, thumb_dir: str, mime_type: str) -> Optional[str]:
    """
    Generate thumbnail for image or PDF file.
    Returns the relative path to thumbnail from base data directory or None.
    """
    if not os.path.exists(file_path):
        return None

    os.makedirs(thumb_dir, exist_ok=True)
    basename = os.path.splitext(os.path.basename(file_path))[0]
    thumb_filename = f"thumb_{basename}.webp"
    thumb_path = os.path.join(thumb_dir, thumb_filename)

    # 1. Images
    if mime_type.startswith("image/"):
        try:
            with Image.open(file_path) as img:
                # Convert RGBA/P to RGB for webp saving if necessary
                if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                    # Keep RGBA for transparent images
                    img.thumbnail(THUMB_SIZE, Image.Resampling.LANCZOS)
                    img.save(thumb_path, "WEBP", quality=85)
                else:
                    img = img.convert("RGB")
                    img.thumbnail(THUMB_SIZE, Image.Resampling.LANCZOS)
                    img.save(thumb_path, "WEBP", quality=85)
            return thumb_filename
        except Exception as e:
            logger.warning(f"Failed to generate image thumbnail for {file_path}: {e}")
            return None

    # 2. PDF Documents via PyMuPDF
    if mime_type == "application/pdf" and fitz is not None:
        try:
            doc = fitz.open(file_path)
            if doc.page_count > 0:
                page = doc.load_page(0)
                # Render page at 1.5x zoom
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                # Convert to PIL Image for thumbnail resizing and WebP compression
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                img.thumbnail(THUMB_SIZE, Image.Resampling.LANCZOS)
                img.save(thumb_path, "WEBP", quality=85)
                doc.close()
                return thumb_filename
            doc.close()
        except Exception as e:
            logger.warning(f"Failed to generate PDF thumbnail for {file_path}: {e}")
            return None

    return None

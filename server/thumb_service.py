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

    # All previews and thumbnails disabled: all files are treated uniformly without preview
    return None


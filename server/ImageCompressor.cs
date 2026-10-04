using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;

namespace LinkFlow;

/// <summary>Makes a small JPEG copy of an uploaded photo; the original is never touched.</summary>
internal static class ImageCompressor
{
    private const string Category = "LinkFlow.Image";
    private const int MaxEdge = 1920;
    private const long Quality = 80;
    private const long MinSourceBytes = 300 * 1024;
    private const int OrientationTag = 0x0112;

    private static readonly string[] Exts = { ".jpg", ".jpeg", ".png", ".bmp" };

    /// <summary>
    /// Writes the compressed copy to a new file in <paramref name="tempDir"/> and returns its path,
    /// or null when the file is not a worthwhile candidate (not an image, small, or no saving).
    /// </summary>
    public static string? TryCompress(string sourcePath, string fileName, string tempDir)
    {
        if (!Exts.Contains(Path.GetExtension(fileName), StringComparer.OrdinalIgnoreCase)) return null;
        long sourceSize;
        try { sourceSize = new FileInfo(sourcePath).Length; } catch { return null; }
        if (sourceSize < MinSourceBytes) return null;

        string output = Path.Combine(tempDir, Guid.NewGuid().ToString("N") + ".part");
        try
        {
            using var stream = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var image = Image.FromStream(stream, false, true);

            double scale = Math.Min(1.0, (double)MaxEdge / Math.Max(image.Width, image.Height));
            int w = Math.Max(1, (int)Math.Round(image.Width * scale));
            int h = Math.Max(1, (int)Math.Round(image.Height * scale));

            using var bitmap = new Bitmap(w, h, PixelFormat.Format24bppRgb);
            bitmap.SetResolution(96, 96);
            using (var g = Graphics.FromImage(bitmap))
            using (var attrs = new ImageAttributes())
            {
                attrs.SetWrapMode(WrapMode.TileFlipXY);
                g.Clear(Color.White); // JPEG has no alpha
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.DrawImage(image, new Rectangle(0, 0, w, h), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel, attrs);
            }

            // GDI+ ignores the EXIF orientation of phone photos; bake it into the pixels.
            if (image.PropertyIdList.Contains(OrientationTag))
            {
                var value = image.GetPropertyItem(OrientationTag)?.Value;
                var flip = (value is { Length: > 0 } ? value[0] : 1) switch
                {
                    2 => RotateFlipType.RotateNoneFlipX,
                    3 => RotateFlipType.Rotate180FlipNone,
                    4 => RotateFlipType.RotateNoneFlipY,
                    5 => RotateFlipType.Rotate90FlipX,
                    6 => RotateFlipType.Rotate90FlipNone,
                    7 => RotateFlipType.Rotate270FlipX,
                    8 => RotateFlipType.Rotate270FlipNone,
                    _ => RotateFlipType.RotateNoneFlipNone,
                };
                if (flip != RotateFlipType.RotateNoneFlipNone) bitmap.RotateFlip(flip);
            }

            var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, Quality);
            bitmap.Save(output, jpeg, parameters);

            if (new FileInfo(output).Length >= sourceSize * 0.85)
            {
                File.Delete(output);
                return null;
            }
            return output;
        }
        catch (Exception ex)
        {
            AppLog.Warn(Category, $"Could not compress {fileName}", ex);
            try { File.Delete(output); } catch { }
            return null;
        }
    }
}

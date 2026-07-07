import os
from PIL import Image, ImageDraw, ImageFilter

def create_stock_icon(size):
    # Work at 4x resolution for antialiasing, then downscale
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background rounded rectangle - dark navy (#0f172a)
    margin = max(scale, int(s * 0.04))
    radius = max(4, int(s * 0.22))
    bg_color = (15, 23, 42, 255)
    draw.rounded_rectangle(
        [margin, margin, s - margin, s - margin],
        radius=radius,
        fill=bg_color
    )

    # Chart line points (upward bullish trend with dip)
    points = [
        (int(s * 0.18), int(s * 0.72)),
        (int(s * 0.35), int(s * 0.50)),
        (int(s * 0.48), int(s * 0.58)),
        (int(s * 0.65), int(s * 0.38)),
        (int(s * 0.82), int(s * 0.22)),
    ]

    # Draw gradient fill under the line
    fill_points = points + [
        (int(s * 0.82), int(s * 0.82)),
        (int(s * 0.18), int(s * 0.82)),
    ]
    # Create gradient fill mask
    fill_img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill_img)
    fill_draw.polygon(fill_points, fill=(16, 185, 129, 60))
    # Apply vertical gradient fade
    for y in range(s):
        alpha_factor = max(0, 1 - (y / s) * 1.2)
        for x in range(s):
            r, g, b, a = fill_img.getpixel((x, y))
            if a > 0:
                fill_img.putpixel((x, y), (r, g, b, int(a * alpha_factor)))
    img = Image.alpha_composite(img, fill_img)
    draw = ImageDraw.Draw(img)

    # Glow effect - draw thick blurred line underneath
    glow_img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_thickness = max(6, int(s * 0.06))
    glow_draw.line(points, fill=(16, 185, 129, 80), width=glow_thickness * 3, joint="curve")
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=glow_thickness))
    img = Image.alpha_composite(img, glow_img)
    draw = ImageDraw.Draw(img)

    # Main chart line - emerald green (#10b981)
    line_color = (16, 185, 129, 255)
    thickness = max(4, int(s * 0.04))
    draw.line(points, fill=line_color, width=thickness, joint="curve")

    # Data point dots
    dot_radius = max(3, int(s * 0.035))
    for px, py in points:
        # Outer glow
        draw.ellipse(
            [px - dot_radius * 2, py - dot_radius * 2, px + dot_radius * 2, py + dot_radius * 2],
            fill=(16, 185, 129, 40)
        )
        # Inner dot
        draw.ellipse(
            [px - dot_radius, py - dot_radius, px + dot_radius, py + dot_radius],
            fill=line_color
        )
        # White center highlight
        highlight_r = max(1, dot_radius // 2)
        draw.ellipse(
            [px - highlight_r, py - highlight_r, px + highlight_r, py + highlight_r],
            fill=(255, 255, 255, 180)
        )

    # Downscale with high-quality antialiasing
    img = img.resize((size, size), Image.LANCZOS)
    return img

def main():
    os.makedirs("icons", exist_ok=True)
    sizes = [16, 48, 128]
    for size in sizes:
        img = create_stock_icon(size)
        img.save(f"icons/icon-{size}.png")
        print(f"Generated icons/icon-{size}.png ({size}x{size})")

if __name__ == "__main__":
    main()

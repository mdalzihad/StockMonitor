import os
from PIL import Image, ImageDraw

def create_stock_icon(size):
    # Create image with transparent background
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw background rounded rectangle (slate-900 like theme color)
    margin = max(1, int(size * 0.05))
    bg_color = (15, 23, 42, 255) # #0f172a
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=max(2, int(size * 0.2)),
        fill=bg_color
    )
    
    # Coordinates for stock trend line (upward trend)
    # Scaled based on size
    p1 = (int(size * 0.25), int(size * 0.70))
    p2 = (int(size * 0.50), int(size * 0.45))
    p3 = (int(size * 0.75), int(size * 0.25))
    
    # Colors
    line_color = (16, 185, 129, 255) # emerald-500 (#10b981)
    
    # Line thickness
    thickness = max(2, int(size * 0.08))
    
    # Draw line
    draw.line([p1, p2, p3], fill=line_color, width=thickness, joint="round")
    
    # Draw circles at points
    dot_radius = max(3, int(size * 0.10))
    draw.ellipse([p1[0] - dot_radius, p1[1] - dot_radius, p1[0] + dot_radius, p1[1] + dot_radius], fill=line_color)
    draw.ellipse([p2[0] - dot_radius, p2[1] - dot_radius, p2[0] + dot_radius, p2[1] + dot_radius], fill=line_color)
    draw.ellipse([p3[0] - dot_radius, p3[1] - dot_radius, p3[0] + dot_radius, p3[1] + dot_radius], fill=line_color)
    
    return img

def main():
    os.makedirs("icons", exist_ok=True)
    sizes = [16, 48, 128]
    for size in sizes:
        img = create_stock_icon(size)
        img.save(f"icons/icon-{size}.png")
        print(f"Generated icons/icon-{size}.png")

if __name__ == "__main__":
    main()

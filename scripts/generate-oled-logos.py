"""Convierte los PNG oficiales en mapas de bits Adafruit GFX 128x64 (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "firmware/assets/hack-the-andes"
LOGOS = [
    ("hack-the-andes", "HackTheAndes", "GRACIAS"),
    ("peru-tech-week", "PeruTechWeek", "ALIADO"),
    ("chofex", "Chofex", "SPONSOR PRINCIPAL"),
    ("crafter-station", "CrafterStation", "ORGANIZA"),
]


def main():
    header = ["#pragma once", "// Generado con scripts/generate-oled-logos.py. Logos oficiales: ver firmware/assets/hack-the-andes/README.md.",
              "#include <Arduino.h>", "namespace robolab {", "namespace event_logos {"]
    previews = []
    for name, symbol, label in LOGOS:
        source = Image.open(ASSETS / (name + ".png")).convert("RGBA")
        background = Image.new("RGBA", source.size, "black")
        background.alpha_composite(source)
        gray = background.convert("L")
        gray = gray.crop(gray.point(lambda p: 255 if p > 96 else 0).getbbox())
        gray.thumbnail((124, 40), Image.Resampling.LANCZOS)
        frame = Image.new("1", (128, 64), 0)
        frame.paste(gray.point(lambda p: 255 if p >= 112 else 0).convert("1"),
                    ((128 - gray.width) // 2, 12 + (40 - gray.height) // 2))
        draw = ImageDraw.Draw(frame)
        font = ImageFont.load_default(size=8)
        box = draw.textbbox((0, 0), label, font=font)
        draw.text(((128 - (box[2] - box[0])) // 2, 0), label, font=font, fill=1)
        frame.save(ASSETS / (name + "-oled.pbm"))
        data = frame.tobytes()
        assert len(data) == 1024
        header.append("static const uint8_t " + symbol + "[] PROGMEM = {")
        header.extend("  " + ",".join(f"0x{b:02x}" for b in data[i:i + 16]) + "," for i in range(0, len(data), 16))
        header.append("};")
        previews.append(frame.convert("RGB").resize((512, 256), Image.Resampling.NEAREST))
    header.extend(["} // namespace event_logos", "} // namespace robolab", ""])
    (ROOT / "firmware/robolab_bluetooth/EventLogos.h").write_text("\n".join(header), encoding="utf-8")
    preview = Image.new("RGB", (1040, 528), (32, 32, 32))
    for i, frame in enumerate(previews):
        preview.paste(frame, ((i % 2) * 528, (i // 2) * 272))
    preview.save(ASSETS / "preview.png")


if __name__ == "__main__":
    main()

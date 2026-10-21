#pragma once
#include <cstdint>
#include <cstring>

namespace robolab {
// Calcula efectos sin esperar ni tocar hardware; tolera el rollover de millis().
class EventPresentation {
 public:
  enum class Frame : uint8_t { HackTheAndes, PeruTechWeek, Chofex, CrafterStation, MealReminder, None };
  static constexpr uint32_t SLIDE_MS = 3000;
  static constexpr uint32_t REVEAL_MS = 400;
  struct MotorOutput { uint8_t left, right; };

  bool onReply(const char* id, const char* value, uint32_t now) {
    if (!*id && std::strncmp(value, "ROBO/1 ", 7) == 0) {
      started_ = now;
      playing_ = true;
      hasPing_ = false;
      return true;
    } else if (!*id && std::strcmp(value, "PONG") == 0 && playing_) {
      lastPing_ = now;
      hasPing_ = true;
    } else if (std::strcmp(value, "RUN") == 0 || std::strcmp(value, "STOPPED") == 0 ||
               std::strncmp(value, "ERR:", 4) == 0) {
      cancel();
    }
    return false;
  }
  void cancel() { playing_ = false; }
  Frame frame(uint32_t now) {
    const uint32_t elapsed = now - started_;
    if (elapsed >= static_cast<uint8_t>(Frame::None) * SLIDE_MS) playing_ = false;
    return playing_ ? static_cast<Frame>(elapsed / SLIDE_MS) : Frame::None;
  }
  uint8_t columns(uint32_t now) {
    if (frame(now) == Frame::None) return 0;
    const uint32_t elapsed = (now - started_) % SLIDE_MS;
    return elapsed >= REVEAL_MS ? 128 : static_cast<uint8_t>(elapsed * 128 / REVEAL_MS);
  }
  uint16_t tone(uint32_t now) {
    const Frame current = frame(now);
    if (current == Frame::None) return 0;
    const uint32_t phase = (now - started_) % SLIDE_MS;
    if (phase >= 720 || phase % 180 >= 120) return 0;
    static const uint16_t melodies[5][4] = {
      {523,659,784,1047}, {659,784,988,1319},
      {784,988,1175,1568}, {1047,784,659,523}, {1047,1319,1175,1568}
    };
    return melodies[static_cast<uint8_t>(current)][phase / 180];
  }
  uint8_t brightness(uint32_t now) {
    if (frame(now) == Frame::None) return 0;
    if (tone(now)) return 245;
    const uint32_t phase = (now - started_) % 1800;
    return static_cast<uint8_t>(20 + 65 * (phase < 900 ? phase : 1800 - phase) / 900);
  }
  MotorOutput motors(uint32_t now, bool connected, bool commandActive) {
    if (!connected || commandActive) { cancel(); return {0,0}; }
    const Frame current = frame(now);
    if (current == Frame::None || !hasPing_) return {0,0};
    if (now - lastPing_ >= 1500) { cancel(); return {0,0}; }
    if (current == Frame::MealReminder) return {0,0};
    const uint32_t phase = (now - started_) % SLIDE_MS;
    // Un pulso corto por logo, después de la entrada OLED y de recibir latidos.
    if (phase < 1500 || phase >= 1600) return {0,0};
    return static_cast<uint8_t>(current) % 2 == 0 ? MotorOutput{60,0} : MotorOutput{0,60};
  }

 private:
  bool playing_ = false;
  bool hasPing_ = false;
  uint32_t started_ = 0, lastPing_ = 0;
};
}

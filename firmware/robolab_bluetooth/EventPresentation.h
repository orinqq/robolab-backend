#pragma once
#include <cstdint>
#include <cstring>

namespace robolab {
// Solo decide qué mostrar: no espera, no toca motores y tolera el rollover de millis().
class EventPresentation {
 public:
  enum class Frame : uint8_t { HackTheAndes, PeruTechWeek, Chofex, CrafterStation, None };
  static constexpr uint32_t SLIDE_MS = 3000;
  static constexpr uint32_t REVEAL_MS = 400;

  void onReply(const char* id, const char* value, uint32_t now) {
    if (!*id && std::strncmp(value, "ROBO/1 ", 7) == 0) {
      started_ = now;
      playing_ = true;
    } else if (std::strcmp(value, "RUN") == 0 || std::strcmp(value, "STOPPED") == 0 ||
               std::strncmp(value, "ERR:", 4) == 0) {
      cancel();
    }
  }
  void cancel() { playing_ = false; }
  Frame frame(uint32_t now) {
    const uint32_t elapsed = now - started_;
    if (elapsed >= 4 * SLIDE_MS) playing_ = false;
    return playing_ ? static_cast<Frame>(elapsed / SLIDE_MS) : Frame::None;
  }
  uint8_t columns(uint32_t now) {
    if (frame(now) == Frame::None) return 0;
    const uint32_t elapsed = (now - started_) % SLIDE_MS;
    return elapsed >= REVEAL_MS ? 128 : static_cast<uint8_t>(elapsed * 128 / REVEAL_MS);
  }

 private:
  bool playing_ = false;
  uint32_t started_ = 0;
};
}

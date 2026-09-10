/** This player only receives pre-cut files: all positions are native file time. */
export function initReadingMusic(root: HTMLElement) {
  if (root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const audio = root.querySelector('audio')!;
  const play = root.querySelector<HTMLButtonElement>('[data-play]')!;
  const repeat = root.querySelector<HTMLButtonElement>('[data-repeat]')!;
  const seek = root.querySelector<HTMLInputElement>('[data-seek]')!;
  const volume = root.querySelector<HTMLInputElement>('[data-volume]')!;
  const error = root.querySelector<HTMLElement>('[data-error]')!;
  const zh = document.documentElement.lang === 'zh';
  const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const duration = () => Number.isFinite(audio.duration) ? audio.duration : Number(root.dataset.duration);
  const render = () => {
    root.querySelector('[data-play-icon]')!.toggleAttribute('data-inactive', !audio.paused);
    root.querySelector('[data-pause-icon]')!.toggleAttribute('data-inactive', audio.paused);
    play.setAttribute('aria-label', audio.paused ? (zh ? '播放配乐' : 'Play music') : (zh ? '暂停配乐' : 'Pause music'));
    seek.max = String(duration());
    seek.value = String(audio.currentTime);
    seek.setAttribute('aria-valuetext', `${time(audio.currentTime)} / ${time(duration())}`);
    root.querySelector('[data-elapsed]')!.textContent = time(audio.currentTime);
    root.querySelector('[data-total]')!.textContent = time(duration());
  };
  let pending = false;
  play.addEventListener('click', async () => {
    if (pending) return;
    if (!audio.paused) { audio.pause(); return; }
    pending = true;
    play.setAttribute('aria-busy', 'true');
    error.hidden = true;
    try {
      if (audio.error) audio.load();
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
    } catch { error.hidden = false; }
    finally { pending = false; play.removeAttribute('aria-busy'); render(); }
  });
  repeat.addEventListener('click', () => {
    audio.loop = !audio.loop;
    repeat.setAttribute('aria-pressed', String(audio.loop));
  });
  const move = (position: number) => {
    if (audio.readyState === 0) return;
    audio.currentTime = Math.max(0, Math.min(duration(), position));
    render();
  };
  seek.addEventListener('input', () => move(Number(seek.value)));
  root.querySelectorAll<HTMLButtonElement>('[data-skip]').forEach(button => {
    button.addEventListener('click', () => move(audio.currentTime + Number(button.dataset.skip)));
  });
  root.querySelector('[data-restart]')!.addEventListener('click', () => move(0));
  audio.volume = .25;
  volume.addEventListener('input', () => { audio.volume = Number(volume.value); });
  ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach(event => audio.addEventListener(event, render));
  audio.addEventListener('error', () => { error.hidden = false; render(); });
  window.addEventListener('pagehide', () => audio.pause());
  audio.controls = false;
  root.querySelector<HTMLElement>('.music-custom')!.hidden = false;
  render();
}

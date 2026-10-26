import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Heart, ListMusic, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { useMusic } from "@/store/music";
import { musicTime, saveMusic } from "@/lib/music";
import "./music.css";

export function MusicPlayer() {
  const state = useMusic();
  const audio = useRef<HTMLAudioElement>(null);
  const location = useLocation();
  const track = state.tracks.find(t => t.id === state.currentId);
  useEffect(() => { void useMusic.getState().initialize(); }, []);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.pause();
    useMusic.setState({ position: 0 });
    if (!track) { element.removeAttribute("src"); element.load(); return; }
    const url = URL.createObjectURL(track.blob);
    element.src = url;
    element.load();
    return () => { element.pause(); element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url); };
  }, [track?.id]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !track) return;
    if (state.seekTo !== null) {
      element.currentTime = state.seekTo;
      useMusic.setState({ seekTo: null });
    }
    if (state.playing) {
      void element.play().catch(error => {
        if (error.name === "AbortError") return;
        if (useMusic.getState().currentId !== track.id) return;
        useMusic.setState({ playing: false, error: error.name === "NotAllowedError" ? "请点击播放按钮开始播放。" : "无法解码此音频，请尝试其他文件或转换为 MP3 / WAV。" });
      });
    } else element.pause();
  }, [state.playing, track?.id, state.seekTo]);
  useEffect(() => { if (audio.current) audio.current.volume = state.volume; }, [state.volume]);

  const visible = location.pathname === "/music" || !!track;
  const ModeIcon = state.mode === "shuffle" ? Shuffle : state.mode === "single" ? Repeat1 : Repeat;
  const modeLabel = state.mode === "shuffle" ? "随机播放" : state.mode === "single" ? "单曲循环" : "列表循环";
  return <>
    <audio ref={audio} preload="metadata"
      onTimeUpdate={event => useMusic.setState({ position: event.currentTarget.currentTime })}
      onLoadedMetadata={event => {
        const duration = event.currentTarget.duration;
        const current = useMusic.getState().tracks.find(t => t.id === useMusic.getState().currentId);
        if (!current || !Number.isFinite(duration)) return;
        const updated = { ...current, duration };
        useMusic.setState(s => ({ tracks: s.tracks.map(t => t.id === current.id ? updated : t) }));
        void saveMusic([updated]).catch(() => {});
      }}
      onEnded={() => useMusic.getState().next(1, true)}
      onError={() => { if (audio.current?.getAttribute("src")) useMusic.setState({ playing: false, error: "无法读取或解码此音频。当前系统可能不支持该编码，请尝试 MP3 / WAV 文件。" }); }} />
    {visible && <div className="music-player">
      <div className="music-now"><div className="music-mini-cover"><Music2 size={23} /></div><div className="min-w-0"><strong>{track?.title ?? "还没有正在播放的音乐"}</strong><span>{track?.artist ?? "导入音乐，开启你的私人电台"}</span></div><button className={`music-icon ${track?.favorite ? "is-liked" : ""}`} aria-label="收藏当前歌曲" disabled={!track} onClick={() => track && void state.favorite(track.id)}><Heart size={18} fill={track?.favorite ? "currentColor" : "none"} /></button></div>
      <div className="music-controls"><div className="music-transport"><button className="music-icon" title={modeLabel} aria-label={modeLabel} onClick={() => useMusic.setState({ mode: state.mode === "loop" ? "single" : state.mode === "single" ? "shuffle" : "loop" })}><ModeIcon size={18} /></button><button className="music-icon" aria-label="上一首" disabled={!state.tracks.length} onClick={() => state.next(-1)}><SkipBack size={20} /></button><button className="music-play" aria-label={state.playing ? "暂停" : "播放"} disabled={!state.tracks.length} onClick={state.toggle}>{state.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button className="music-icon" aria-label="下一首" disabled={!state.tracks.length} onClick={() => state.next()}><SkipForward size={20} /></button><span className="music-mode-text">{modeLabel}</span></div><div className="music-progress"><span>{musicTime(state.position)}</span><input aria-label="播放进度" type="range" min="0" max={track?.duration || 0} step="0.1" value={Math.min(state.position, track?.duration || 0)} disabled={!track?.duration} onChange={event => useMusic.setState({ seekTo: Number(event.target.value), position: Number(event.target.value) })} /><span>{musicTime(track?.duration ?? 0)}</span></div></div>
      <div className="music-volume"><label title="音量">{state.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}<input aria-label="音量" type="range" min="0" max="1" step="0.01" value={state.volume} onChange={event => useMusic.setState({ volume: Number(event.target.value) })} /></label><button className="music-icon" aria-label="播放队列" aria-expanded={state.queueOpen} onClick={() => useMusic.setState({ queueOpen: !state.queueOpen })}><ListMusic size={22} /><small>{state.tracks.length}</small></button></div>
      {state.queueOpen && <section className="music-queue"><header><div><strong>播放队列</strong><span>{state.tracks.length} 首音乐</span></div><button className="music-icon" aria-label="关闭播放队列" onClick={() => useMusic.setState({ queueOpen: false })}><X size={18} /></button></header><div className="music-queue-list">{state.tracks.length ? state.tracks.map(t => <button className={t.id === state.currentId ? "active" : ""} key={t.id} onClick={() => state.play(t.id)}><Music2 size={16} /><span>{t.title}<small>{t.artist}</small></span><small>{musicTime(t.duration)}</small></button>) : <p>导入的音乐会出现在这里</p>}</div></section>}
      {state.error && location.pathname !== "/music" && <div className="music-player-error" role="alert">{state.error}<button aria-label="关闭提示" onClick={() => useMusic.setState({ error: "" })}><X size={16} /></button></div>}
    </div>}
  </>;
}

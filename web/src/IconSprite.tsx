// Hand-drawn icon set (1.75px stroke, rounded caps/joins) replacing every
// emoji-as-icon in the app — mounted once near the root; individual icons
// are referenced via <Icon name="..." /> (see Icon.tsx), which just does
// <svg><use href="#i-name"/></svg> against this sprite.
export default function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-resources" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></symbol>
        <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4.2" /><line x1="11" y1="12" x2="20.5" y2="2.5" /><line x1="15.5" y1="7.5" x2="18" y2="5" /><line x1="18" y1="5" x2="20.5" y2="7.5" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></symbol>
        <symbol id="i-map" viewBox="0 0 24 24"><path d="M3 6.5l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><line x1="9" y1="3.5" x2="9" y2="18.5" /><line x1="15" y1="6.5" x2="15" y2="21.5" /></symbol>
        <symbol id="i-camera" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8.5 7l1.3-2.5h4.4L15.5 7" /><circle cx="12" cy="13.6" r="3.6" /></symbol>
        <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3l9 4.5-9 4.5-9-4.5z" /><path d="M3 12.5l9 4.5 9-4.5" /><path d="M3 17l9 4.5 9-4.5" /></symbol>
        <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l0.8-4.2L15.5 5 19 8.5 8.2 19.2z" /><line x1="13.5" y1="6.8" x2="17.2" y2="10.5" /></symbol>
        <symbol id="i-activity" viewBox="0 0 24 24"><path d="M2.5 12h4l2-7.5 4 15 2-7.5h7" /></symbol>
        <symbol id="i-list" viewBox="0 0 24 24"><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /><line x1="8.5" y1="6" x2="21" y2="6" /><line x1="8.5" y1="12" x2="21" y2="12" /><line x1="8.5" y1="18" x2="21" y2="18" /></symbol>
        <symbol id="i-play-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" /></symbol>
        <symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0z" /><line x1="12" y1="18" x2="12" y2="21.5" /></symbol>
        <symbol id="i-bars" viewBox="0 0 24 24"><line x1="5" y1="18" x2="5" y2="14" /><line x1="11" y1="18" x2="11" y2="9" /><line x1="17" y1="18" x2="17" y2="4" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20c0-3.6 2.8-6 6.2-6s6.2 2.4 6.2 6" /><circle cx="17.5" cy="9" r="2.6" /><path d="M15.6 12.2c2.6 0.3 4.6 2.3 4.6 5.3" /></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v6c0 5-3.2 8.3-7.5 10-4.3-1.7-7.5-5-7.5-10v-6z" /></symbol>
        <symbol id="i-building" viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" /><line x1="8.5" y1="6.5" x2="10.5" y2="6.5" /><line x1="13.5" y1="6.5" x2="15.5" y2="6.5" /><line x1="8.5" y1="10.5" x2="10.5" y2="10.5" /><line x1="13.5" y1="10.5" x2="15.5" y2="10.5" /><line x1="8.5" y1="14.5" x2="10.5" y2="14.5" /><line x1="13.5" y1="14.5" x2="15.5" y2="14.5" /><line x1="10" y1="21.5" x2="10" y2="17.5" /><line x1="14" y1="21.5" x2="14" y2="17.5" /></symbol>
        <symbol id="i-radar" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /><line x1="12" y1="12" x2="18.5" y2="6.5" /></symbol>
        <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 15.5v-11" /><path d="M7 8.7l5-4.7 5 4.7" /><path d="M4 20h16" /></symbol>
        <symbol id="i-check-shield" viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v6c0 5-3.2 8.3-7.5 10-4.3-1.7-7.5-5-7.5-10v-6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></symbol>
        <symbol id="i-puzzle" viewBox="0 0 24 24"><path d="M9 4h4v1.8a1.8 1.8 0 1 0 0 3.4V11h5v4.8a1.8 1.8 0 1 1-3.4 0H13v4H9v-4H4.8a1.8 1.8 0 1 1 0-3.4V9H9z" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><line x1="20" y1="20" x2="15.7" y2="15.7" /></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><line x1="12" y1="2.5" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21.5" /><line x1="2.5" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21.5" y2="12" /><line x1="5" y1="5" x2="6.8" y2="6.8" /><line x1="17.2" y1="17.2" x2="19" y2="19" /><line x1="19" y1="5" x2="17.2" y2="6.8" /><line x1="6.8" y1="17.2" x2="5" y2="19" /></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></symbol>
        <symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="M14.5 5l-7 7 7 7" /></symbol>
        <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="M9.5 5l7 7-7 7" /></symbol>
        <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="M5 9.5l7 7 7-7" /></symbol>
        <symbol id="i-save" viewBox="0 0 24 24"><path d="M12 4v9" /><path d="M8 9.7L12 13.5 16 9.7" /><path d="M4 20h16" /></symbol>
        <symbol id="i-load" viewBox="0 0 24 24"><path d="M12 13.5V4.5" /><path d="M8 8.3L12 4.5 16 8.3" /><path d="M4 20h16" /></symbol>
        <symbol id="i-undo" viewBox="0 0 24 24"><path d="M7 8H15.5A5 5 0 0 1 20.5 13A5 5 0 0 1 15.5 18H10" /><path d="M10.5 4.5L6 8l4.5 3.5" /></symbol>
        <symbol id="i-redo" viewBox="0 0 24 24"><path d="M17 8H8.5A5 5 0 0 0 3.5 13A5 5 0 0 0 8.5 18H14" /><path d="M13.5 4.5L18 8l-4.5 3.5" /></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.8" /><path d="M15.5 8.5V5.8A1.8 1.8 0 0 0 13.7 4H5.8A1.8 1.8 0 0 0 4 5.8v7.9a1.8 1.8 0 0 0 1.8 1.8H8.5" /></symbol>
        <symbol id="i-clipboard" viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="16" rx="1.8" /><rect x="9" y="2.5" width="6" height="3.5" rx="1" /></symbol>
        <symbol id="i-dup" viewBox="0 0 24 24"><rect x="4" y="4" width="10" height="10" rx="1.8" /><path d="M9 19.5h9a1.8 1.8 0 0 0 1.8-1.8v-9" /></symbol>
        <symbol id="i-download-doc" viewBox="0 0 24 24"><path d="M7 3.5h7l3.5 3.5V20.5h-14V3.5z" /><path d="M14 3.5V7h3.5" /><path d="M12 11v6" /><path d="M9.3 14.5L12 17.2l2.7-2.7" /></symbol>
        <symbol id="i-align" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="17" y2="18" /></symbol>
        <symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M9 20H4v-5" /><path d="M15 20h5v-5" /></symbol>
        <symbol id="i-share" viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><line x1="8.1" y1="10.8" x2="15.9" y2="7.2" /><line x1="8.1" y1="13.2" x2="15.9" y2="16.8" /></symbol>
        <symbol id="i-keyboard" viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2" /><line x1="6" y1="10" x2="6" y2="10" /><line x1="9.5" y1="10" x2="9.5" y2="10" /><line x1="13" y1="10" x2="13" y2="10" /><line x1="16.5" y1="10" x2="16.5" y2="10" /><line x1="7" y1="14" x2="17" y2="14" /></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path d="M5 7h14" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 13h9l1-13" /><line x1="10.2" y1="10.5" x2="10.2" y2="17" /><line x1="13.8" y1="10.5" x2="13.8" y2="17" /></symbol>
        <symbol id="i-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></symbol>
        <symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-1-8.9A5.5 5.5 0 0 1 16.5 8 4 4 0 0 1 17 16" /></symbol>
        <symbol id="i-lambda" viewBox="0 0 24 24"><path d="M6 20L11 6l3 6 3-6" /><path d="M14 12l-3 8" /></symbol>
        <symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></symbol>
        <symbol id="i-bucket" viewBox="0 0 24 24"><path d="M5 8h14l-1.4 11.5a2 2 0 0 1-2 1.5H8.4a2 2 0 0 1-2-1.5z" /><path d="M5 8L7 4h10l2 4" /></symbol>
        <symbol id="i-scale" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21" /><line x1="4" y1="7" x2="20" y2="7" /><path d="M4 7l-2.5 6h5z" /><path d="M20 7l-2.5 6h5z" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-net" viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><line x1="12" y1="6.5" x2="12" y2="12" /><line x1="12" y1="12" x2="5" y2="16.2" /><line x1="12" y1="12" x2="19" y2="16.2" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></symbol>
        <symbol id="i-minus" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /></symbol>
        <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M3 12h5l1.8 3.5h4.4L16 12h5" /><path d="M5.5 5h13L21 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V12z" /></symbol>
        <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 3.5l10 17.5H2z" /><line x1="12" y1="10" x2="12" y2="14.5" /><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-minimize" viewBox="0 0 24 24"><path d="M4 9h5V4" /><path d="M20 9h-5V4" /><path d="M4 15h5v5" /><path d="M20 15h-5v5" /></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.1 5.9l-1.55 1.55M7.45 16.55L5.9 18.1M18.1 18.1l-1.55-1.55M7.45 7.45L5.9 5.9" /></symbol>
        <symbol id="i-bot" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2.5" /><line x1="12" y1="8" x2="12" y2="4.5" /><circle cx="12" cy="3.2" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="14" r="1.4" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.4" fill="currentColor" stroke="none" /><line x1="8" y1="18" x2="16" y2="18" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /></symbol>
      </defs>
    </svg>
  );
}

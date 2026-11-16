/**
 * proxx brand mark: an indigo tile with a forward double chevron (a request passing through).
 * Inline SVG data URI so the single-file build needs no external asset.
 */
const PROXX_LOGO_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7c86ea"/><stop offset="1" stop-color="#4b56c0"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="url(#g)"/>
<path d="M19 20l13 12-13 12M33 20l13 12-13 12" fill="none" stroke="#fff" stroke-width="6"
 stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const PROXX_LOGO_SVG = `data:image/svg+xml,${encodeURIComponent(PROXX_LOGO_SOURCE)}`;

export const PROXX_BRAND_NAME = 'proxx';

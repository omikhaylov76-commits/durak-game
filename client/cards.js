// Card face SVG generation — pure functions, no DOM needed.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANK_LABELS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };

const SUIT_PATHS = {
  '♠': "M50 6 C68 28 88 40 88 58 C88 72 76 80 65 78 C59 77 55 73 53 69 C53 78 57 86 63 92 L37 92 C43 86 47 78 47 69 C45 73 41 77 35 78 C24 80 12 72 12 58 C12 40 32 28 50 6 Z",
  '♥': "M50 92 C22 68 8 52 8 34 C8 20 19 10 31 10 C40 10 47 15 50 23 C53 15 60 10 69 10 C81 10 92 20 92 34 C92 52 78 68 50 92 Z",
  '♦': "M50 4 C72 30 88 44 88 50 C88 56 72 70 50 96 C28 70 12 56 12 50 C12 44 28 30 50 4 Z",
};

const PIPS = {
  2: [[.5,.25],[.5,.75]],
  3: [[.5,.24],[.5,.5],[.5,.76]],
  4: [[.3,.25],[.7,.25],[.3,.75],[.7,.75]],
  5: [[.3,.25],[.7,.25],[.5,.5],[.3,.75],[.7,.75]],
  6: [[.3,.28],[.7,.28],[.3,.5],[.7,.5],[.3,.72],[.7,.72]],
  7: [[.3,.26],[.7,.26],[.5,.38],[.3,.5],[.7,.5],[.3,.74],[.7,.74]],
  8: [[.3,.24],[.7,.24],[.5,.36],[.3,.5],[.7,.5],[.5,.64],[.3,.76],[.7,.76]],
  9: [[.3,.22],[.7,.22],[.3,.41],[.7,.41],[.5,.5],[.3,.59],[.7,.59],[.3,.78],[.7,.78]],
  10: [[.3,.2],[.7,.2],[.5,.3],[.3,.4],[.7,.4],[.3,.6],[.7,.6],[.5,.7],[.3,.8],[.7,.8]],
};

function suitColor(s) {
  return (s === '♥' || s === '♦') ? '#B3362A' : '#2A2622';
}

function suitSVG(suit, color, cx, cy, s, rot = 0) {
  const tr = `translate(${cx} ${cy}) rotate(${rot}) scale(${s / 100}) translate(-50 -50)`;
  if (suit === '♣') {
    return `<g transform="${tr}" fill="${color}"><circle cx="50" cy="27" r="19"/><circle cx="29" cy="55" r="19"/><circle cx="71" cy="55" r="19"/><path d="M44 56 C44 72 40 84 33 92 L67 92 C60 84 56 72 56 56 Z"/></g>`;
  }
  return `<path transform="${tr}" fill="${color}" d="${SUIT_PATHS[suit]}"/>`;
}

export function faceSVG(card) {
  const W = 285, H = 445;
  const col = suitColor(card.suit);
  const lbl = RANK_LABELS[card.rank];
  const fs = lbl.length > 1 ? 44 : 54;
  const idxW = lbl.length > 1 ? 52 : 36;

  let center = '';
  if (card.rank <= 10) {
    const ps = PIPS[card.rank] || [[.5, .5]];
    for (const p of ps) center += suitSVG(card.suit, col, p[0] * W, p[1] * H, 52, p[1] > .5 ? 180 : 0);
  } else if (card.rank === 14) {
    center += `<circle cx="${W / 2}" cy="${H / 2}" r="118" fill="none" stroke="${col}" stroke-opacity=".22" stroke-width="3"/>${suitSVG(card.suit, col, W / 2, H / 2, 168, 0)}`;
  } else {
    center += `<rect x="58" y="86" width="${W - 116}" height="${H - 172}" rx="10" fill="#EFE5D2" stroke="${col}" stroke-width="3"/>
      <text x="${W / 2}" y="${card.rank === 11 || card.rank === 12 || card.rank === 13 ? H / 2 + 16 : H / 2 + 16}" font-family="Georgia,serif" font-weight="700" font-size="118" fill="${col}" text-anchor="middle">${lbl}</text>
      ${suitSVG(card.suit, col, W / 2, H / 2 + 92, 44, 0)}`;
  }

  const idx = `<g fill="${col}" font-family="Rubik,Arial,sans-serif" font-weight="900"><text x="16" y="58" font-size="${fs}">${lbl}</text>${suitSVG(card.suit, col, 16 + idxW / 2, 90, 32, 0)}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 285 445"><rect x="1.5" y="1.5" width="282" height="442" rx="14" fill="#F6EFE2" stroke="#C9B48E" stroke-width="3"/><rect x="7" y="7" width="271" height="431" rx="10" fill="none" stroke="#E7DCC4" stroke-width="2"/>${center}${idx}<g transform="rotate(180 142.5 222.5)">${idx}</g></svg>`;
}

const BACK_SVG_STR = (() => {
  const W = 285, H = 445;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs><pattern id="bk" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="34" height="34" fill="#5C3A2E"/><rect width="17" height="17" fill="#6B4434"/><rect x="17" y="17" width="17" height="17" fill="#6B4434"/></pattern></defs><rect width="${W}" height="${H}" rx="14" fill="url(#bk)"/><rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="10" fill="none" stroke="#B08D57" stroke-width="3"/><rect x="17" y="17" width="${W - 34}" height="${H - 34}" rx="7" fill="none" stroke="#B08D57" stroke-opacity=".45" stroke-width="1.5"/><g transform="translate(142.5 222.5)"><circle r="56" fill="#66412F" stroke="#B08D57" stroke-width="2.5"/><path d="M0 -34 L34 0 L0 34 L-34 0 Z" fill="none" stroke="#C9A468" stroke-width="3"/><circle r="10" fill="#C9A468"/></g></svg>`;
})();

export const BACK_SVG = BACK_SVG_STR;
export const BACK_URI = `url("data:image/svg+xml,${encodeURIComponent(BACK_SVG_STR)}")`;

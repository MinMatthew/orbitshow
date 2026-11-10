import { lang, SUPPORTED } from './i18n.js';

// TMDb genre ids (movie and TV lists) -> names in the order of SUPPORTED: en, ko, ja, zh, es, fr, de.
const NAMES = {
  28: ['Action', '액션', 'アクション', '动作', 'Acción', 'Action', 'Action'],
  12: ['Adventure', '모험', 'アドベンチャー', '冒险', 'Aventura', 'Aventure', 'Abenteuer'],
  16: ['Animation', '애니메이션', 'アニメーション', '动画', 'Animación', 'Animation', 'Animation'],
  35: ['Comedy', '코미디', 'コメディ', '喜剧', 'Comedia', 'Comédie', 'Komödie'],
  80: ['Crime', '범죄', 'クライム', '犯罪', 'Crimen', 'Crime', 'Krimi'],
  99: ['Documentary', '다큐멘터리', 'ドキュメンタリー', '纪录片', 'Documental', 'Documentaire', 'Dokumentarfilm'],
  18: ['Drama', '드라마', 'ドラマ', '剧情', 'Drama', 'Drame', 'Drama'],
  10751: ['Family', '가족', 'ファミリー', '家庭', 'Familia', 'Familial', 'Familie'],
  14: ['Fantasy', '판타지', 'ファンタジー', '奇幻', 'Fantasía', 'Fantastique', 'Fantasy'],
  36: ['History', '역사', '歴史', '历史', 'Historia', 'Histoire', 'Historie'],
  27: ['Horror', '공포', 'ホラー', '恐怖', 'Terror', 'Horreur', 'Horror'],
  10402: ['Music', '음악', 'ミュージック', '音乐', 'Música', 'Musique', 'Musik'],
  9648: ['Mystery', '미스터리', 'ミステリー', '悬疑', 'Misterio', 'Mystère', 'Mystery'],
  10749: ['Romance', '로맨스', 'ロマンス', '爱情', 'Romance', 'Romance', 'Liebesfilm'],
  878: ['Science Fiction', 'SF', 'SF', '科幻', 'Ciencia ficción', 'Science-Fiction', 'Science Fiction'],
  10770: ['TV Movie', 'TV 영화', 'テレビ映画', '电视电影', 'Película de TV', 'Téléfilm', 'TV-Film'],
  53: ['Thriller', '스릴러', 'スリラー', '惊悚', 'Suspense', 'Thriller', 'Thriller'],
  10752: ['War', '전쟁', '戦争', '战争', 'Bélica', 'Guerre', 'Kriegsfilm'],
  37: ['Western', '서부', '西部劇', '西部', 'Western', 'Western', 'Western'],
  10759: ['Action & Adventure', '액션 & 어드벤처', 'アクション&アドベンチャー', '动作冒险', 'Acción y aventura', 'Action et aventure', 'Action & Abenteuer'],
  10762: ['Kids', '키즈', 'キッズ', '儿童', 'Infantil', 'Enfants', 'Kinder'],
  10763: ['News', '뉴스', 'ニュース', '新闻', 'Noticias', 'Actualités', 'Nachrichten'],
  10764: ['Reality', '리얼리티', 'リアリティ', '真人秀', 'Reality', 'Téléréalité', 'Reality'],
  10765: ['Sci-Fi & Fantasy', 'SF & 판타지', 'SF&ファンタジー', '科幻奇幻', 'Ciencia ficción y fantasía', 'Science-Fiction et fantastique', 'Sci-Fi & Fantasy'],
  10766: ['Soap', '연속극', 'ソープオペラ', '肥皂剧', 'Telenovela', 'Feuilleton', 'Seifenoper'],
  10767: ['Talk', '토크', 'トーク', '脱口秀', 'Entrevistas', 'Talk-show', 'Talk'],
  10768: ['War & Politics', '전쟁 & 정치', '戦争&政治', '战争与政治', 'Bélica y política', 'Guerre et politique', 'Krieg & Politik']
};

const column = SUPPORTED.indexOf(lang);

// Unknown ids are skipped rather than shown as numbers.
export const genreNames = (ids = [], max = 3) => ids.map(id => NAMES[id]?.[column]).filter(Boolean).slice(0, max);

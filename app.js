const STORAGE_PROGRESS = 'wortgarten-static-progress-v1';
const STORAGE_SETTINGS = 'wortgarten-static-settings-v1';
const lessonData = [
  { id: 'all', name: 'All lessons', de: 'The complete collection' },
  { id: '1.1a', name: '1.1a · Where I live', de: 'Wo ich wohne' },
  { id: '1.1b', name: '1.1b · My home', de: 'Mein Zuhause' },
  { id: '1.1c', name: '1.1c · Life at home', de: 'Was ich zu Hause mache' }
];
const defaults = { section: 'all', direction: 'de-en', size: 10, articles: true, pictures: true };
let words = [];
let stats = readStorage(STORAGE_PROGRESS, {});
let settings = { ...defaults, ...readStorage(STORAGE_SETTINGS, {}) };
let round = null;
let currentView = 'practice';

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
  catch { return fallback; }
}
function saveStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The words still work if browser storage is disabled. */ }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function folded(value) {
  return value.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss');
}
function normalize(value, language, checkArticles) {
  let text = value.normalize('NFKC').toLowerCase().trim()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .replace(/\([^)]*\)/g, match => ['(pl)', '(time)'].includes(match) ? '' : match.slice(1, -1))
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (language === 'en') text = text.replace(/^to\s+/, '').replace(/^(a|an|the)\s+/, '');
  else if (!checkArticles) text = text.replace(/^(der|die|das)\s+/, '');
  return text;
}
function isCorrect(word, answer, direction) {
  const language = direction === 'de-en' ? 'en' : 'de';
  const candidates = [...word[language], word[language === 'en' ? 'english' : 'german']];
  const given = normalize(answer, language, settings.articles);
  return !!given && candidates.some(candidate => normalize(candidate, language, settings.articles) === given);
}
function statKey(id, direction) { return id + ':' + direction; }
function learned(word) { return ['de-en', 'en-de'].some(direction => Number(stats[statKey(word.id, direction)]?.streak || 0) >= 2); }
function updateGrowth() {
  const count = words.filter(learned).length;
  document.querySelector('#learned-count').textContent = count;
  document.querySelector('#learned-caption').textContent = count + ' of ' + words.length + ' cards learned';
  document.querySelector('#learned-bar').style.width = (words.length ? count / words.length * 100 : 0) + '%';
}
function renderLessons() {
  const container = document.querySelector('#lesson-list');
  container.innerHTML = lessonData.map(lesson => {
    const count = lesson.id === 'all' ? words.length : words.filter(word => word.section === lesson.id).length;
    return '<button class="lesson' + (settings.section === lesson.id ? ' active' : '') + '" data-lesson="' + lesson.id + '" aria-pressed="' + (settings.section === lesson.id) + '"><b>' + escapeHtml(lesson.name) + '</b><small>' + escapeHtml(lesson.de) + '</small><span class="count">' + count + '</span></button>';
  }).join('');
  container.querySelectorAll('[data-lesson]').forEach(button => button.addEventListener('click', () => {
    settings.section = button.dataset.lesson;
    persistSettings(); renderLessons(); startRound();
  }));
}
function persistSettings() { saveStorage(STORAGE_SETTINGS, settings); }
function selectWords(ids) {
  return words.filter(word => (settings.section === 'all' || settings.section === word.section) && (!ids || ids.includes(word.id)));
}
function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function startRound(ids) {
  const selected = shuffled(selectWords(ids));
  const deck = selected.map(word => {
    const direction = settings.direction === 'mixed' ? (Math.random() < .5 ? 'de-en' : 'en-de') : settings.direction;
    const item = stats[statKey(word.id, direction)];
    const priority = item && item.streak === 0 ? 0 : !item || item.streak < 2 ? 1 : 2;
    return { id: word.id, direction, priority };
  }).sort((a, b) => a.priority - b.priority);
  const cards = ids ? deck : deck.slice(0, Math.min(Number(settings.size), deck.length));
  round = { cards: cards.map(({ id, direction }) => ({ id, direction })), index: 0, score: 0, missed: [], hinted: false, feedback: null };
  renderPractice();
}
function recordAnswer(word, direction, correct, helped) {
  const key = statKey(word.id, direction);
  const old = stats[key] || { seen: 0, correct: 0, streak: 0 };
  const learnedNow = correct && !helped;
  stats[key] = { seen: old.seen + 1, correct: old.correct + Number(learnedNow), streak: learnedNow ? old.streak + 1 : 0 };
  saveStorage(STORAGE_PROGRESS, stats);
  updateGrowth();
  return learnedNow && stats[key].streak >= 2;
}
function currentCard() {
  if (!round || round.index >= round.cards.length) return null;
  const choice = round.cards[round.index];
  return { word: words.find(word => word.id === choice.id), direction: choice.direction };
}
function answerText(word, direction) {
  return direction === 'de-en' ? word.en.join(' · ') : word.de.join(' · ');
}
function partialHint(text) {
  return text.split(' ').map(part => /^(der|die|das|to|a|an|the)$/i.test(part) ? part : part ? part[0] + '·'.repeat(Math.min(part.length - 1, 8)) : '').join(' ');
}
function renderPractice() {
  const target = document.querySelector('#practice-content');
  if (!round) { target.innerHTML = '<div class="empty-state"><h2>Ready when you are.</h2><p>Start a round to practise your German vocabulary.</p><button class="button button-primary" id="start-round">Start practising</button></div>'; target.querySelector('#start-round').addEventListener('click', () => startRound()); return; }
  if (round.index >= round.cards.length) { renderSummary(target); return; }
  const card = currentCard();
  if (!card?.word) { target.innerHTML = '<div class="empty-state"><h2>Could not find that card.</h2><button class="button button-primary" id="restart">Start a new round</button></div>'; target.querySelector('#restart').addEventListener('click', () => startRound()); return; }
  const word = card.word;
  const prompt = card.direction === 'de-en' ? word.german : word.english;
  const targetLanguage = card.direction === 'de-en' ? 'English' : 'German';
  const feedback = round.feedback;
  const correct = feedback?.correct;
  const picture = settings.pictures ? word.svg : '<div class="picture-hidden">Picture clues are switched off.</div>';
  const actions = feedback
    ? '<button class="button button-primary" id="next-card">' + (round.index === round.cards.length - 1 ? 'Finish round' : 'Next card') + ' <span aria-hidden="true">→</span></button>'
    : '<button class="button button-primary" id="check-answer">Check answer <span aria-hidden="true">↵</span></button><button class="button button-outline" id="hint-button"' + (round.hinted ? ' disabled' : '') + '>Hint</button>';
  const message = feedback ? '<div class="answer-message ' + (correct ? '' : 'feedback-wrong') + '"><strong>' + (feedback.learned ? 'Richtig! You got it.' : correct ? 'Correct — with a little help.' : 'Keep this one for review.') + '</strong><span class="expected">' + escapeHtml(feedback.expected) + (word.note ? ' · ' + escapeHtml(word.note) : '') + '</span></div>' : '<div class="answer-message"></div>';
  target.innerHTML = '<div class="progress-row"><span>Card <b>' + (round.index + 1) + ' / ' + round.cards.length + '</b></span><span><b>' + round.score + '</b> correct</span></div><div class="round-track"><span style="width:' + ((round.index + Number(Boolean(feedback))) / round.cards.length * 100) + '%"></span></div>' +
    '<article class="practice-card"><div class="picture-panel"><div class="picture-heading"><span>' + word.section + ' · AT HOME</span><span class="pill">PICTURE CLUE</span></div><div class="picture-svg">' + picture + '</div><p class="clue-caption">A picture to help the word stick.</p></div>' +
    '<div class="question-panel"><div class="language-label">' + (card.direction === 'de-en' ? 'German → English' : 'English → German') + '</div><h2 class="prompt" lang="' + (card.direction === 'de-en' ? 'de' : 'en') + '">' + escapeHtml(prompt) + '</h2><p class="instruction">What is the ' + targetLanguage + ' translation?</p>' +
    '<form id="answer-form" autocomplete="off"><label class="answer-label" for="answer">Your answer in ' + targetLanguage + '</label><input id="answer" class="answer-input' + (feedback ? correct ? ' good' : ' bad' : '') + '" name="answer" maxlength="200" placeholder="Type your answer…" autocomplete="off" autocapitalize="none" spellcheck="false" ' + (feedback ? 'disabled' : 'required') + ' aria-describedby="answer-feedback"><div class="umlauts">' + (card.direction === 'en-de' ? '<button type="button" data-char="ä">ä</button><button type="button" data-char="ö">ö</button><button type="button" data-char="ü">ü</button><button type="button" data-char="ß">ß</button><span>ae / oe / ue / ss also work</span>' : '') + '</div><div class="actions">' + actions + '</div></form>' +
    '<div class="reveal-row"><span class="hint-text" role="status">' + (round.hinted && !feedback ? escapeHtml(partialHint(answerText(word, card.direction))) : '') + '</span>' + (!feedback ? '<button class="text-button" id="show-answer">Show answer</button>' : '') + '</div><div id="answer-feedback" aria-live="polite">' + message + '</div></div></article>' +
    '<div class="below-card"><span>' + (card.direction === 'en-de' && settings.articles ? 'Include der, die, or das for nouns.' : 'Any one of the listed translations is enough.') + '</span><span><kbd>Enter</kbd> check &amp; continue</span></div>';
  const input = target.querySelector('#answer');
  target.querySelector('#answer-form').addEventListener('submit', event => { event.preventDefault(); if (feedback) advance(); else submitAnswer(input.value, false); });
  target.querySelector('#hint-button')?.addEventListener('click', () => { round.hinted = true; const hint = target.querySelector('.hint-text'); hint.textContent = partialHint(answerText(word, card.direction)); input.focus(); });
  target.querySelector('#show-answer')?.addEventListener('click', () => submitAnswer('', true));
  target.querySelector('#next-card')?.addEventListener('click', advance);
  target.querySelectorAll('[data-char]').forEach(button => button.addEventListener('click', () => {
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + button.dataset.char + input.value.slice(end);
    input.focus(); input.setSelectionRange(start + 1, start + 1);
  }));
}
function submitAnswer(answer, reveal) {
  const card = currentCard();
  if (!card || round.feedback) return;
  if (!reveal && !answer.trim()) { document.querySelector('#answer').focus(); return; }
  const correct = !reveal && isCorrect(card.word, answer, card.direction);
  const mastery = recordAnswer(card.word, card.direction, correct, round.hinted || reveal);
  const acceptedAnswer = answerText(card.word, card.direction);
  round.feedback = { correct, learned: mastery, expected: acceptedAnswer };
  if (mastery) round.score++;
  if (!mastery) round.missed.push(card.word.id);
  renderPractice();
}
function advance() {
  if (!round?.feedback) return;
  round.index++;
  round.hinted = false;
  round.feedback = null;
  renderPractice();
}
function renderSummary(target) {
  const missed = [...new Set(round.missed)];
  target.innerHTML = '<section class="summary"><div class="score">' + round.score + ' / ' + round.cards.length + '<small>UNASSISTED</small></div><h2>' + (round.score === round.cards.length ? 'Wunderbar. A perfect round.' : 'One round closer.') + '</h2><p>' + (missed.length ? missed.length + ' card' + (missed.length === 1 ? ' needs' : 's need') + ' another look. Practise them again while they’re fresh.' : 'Every answer was correct without a hint.') + '</p><div class="summary-actions">' + (missed.length ? '<button class="button button-primary" id="review-missed">↻ Practise these again</button>' : '') + '<button class="button button-outline" id="new-round-summary">Start a new round</button></div><div class="review-list">' + missed.map(id => { const word = words.find(item => item.id === id); return word ? '<div class="review-chip"><b lang="de">' + escapeHtml(word.german) + '</b><span>' + escapeHtml(word.english) + '</span></div>' : ''; }).join('') + '</div></section>';
  target.querySelector('#review-missed')?.addEventListener('click', () => startRound(missed));
  target.querySelector('#new-round-summary').addEventListener('click', () => startRound());
}
function showView(view) {
  currentView = view;
  document.querySelector('#practice-view').classList.toggle('hidden', view !== 'practice');
  document.querySelector('#book-view').classList.toggle('hidden', view !== 'book');
  document.querySelector('#headline').innerHTML = view === 'practice' ? 'Make yourself <em>at home.</em>' : 'A place for <em>every word.</em>';
  document.querySelector('#subhead').textContent = view === 'practice' ? 'Practise the words for home and everyday life.' : 'All 95 illustrated words and phrases, in one place.';
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (view === 'book') renderWordBook();
}
function renderWordBook() {
  const query = folded(document.querySelector('#search').value.trim());
  const shown = words.filter(word => (settings.section === 'all' || word.section === settings.section) && folded([word.german, word.english, word.en.join(' ')].join(' ')).includes(query));
  document.querySelector('#book-count').textContent = shown.length + (shown.length === 1 ? ' card' : ' cards');
  document.querySelector('#word-grid').innerHTML = shown.length ? shown.map(word => '<article class="word-tile"><div class="word-art">' + word.svg + '</div><div class="word-info"><span class="overline">LESSON ' + word.section + '</span><h3 lang="de">' + escapeHtml(word.german) + '</h3><p>' + escapeHtml(word.english) + '</p><div class="tile-foot' + (learned(word) ? ' learned' : '') + '">' + (learned(word) ? '✓ Learned in at least one direction' : 'Ready to practise') + '</div></div></article>').join('') : '<p class="empty">No words found. Try another spelling or lesson.</p>';
}
function initializeControls() {
  document.querySelector('#direction').value = ['de-en', 'en-de', 'mixed'].includes(settings.direction) ? settings.direction : defaults.direction;
  document.querySelector('#round-size').value = ['10', '20', '95'].includes(String(settings.size)) ? String(settings.size) : String(defaults.size);
  document.querySelector('#pictures').checked = settings.pictures !== false;
  document.querySelector('#articles').checked = settings.articles !== false;
  settings.size = Number(document.querySelector('#round-size').value);
  document.querySelector('#direction').addEventListener('change', event => { settings.direction = event.target.value; persistSettings(); startRound(); });
  document.querySelector('#round-size').addEventListener('change', event => { settings.size = Number(event.target.value); persistSettings(); startRound(); });
  document.querySelector('#pictures').addEventListener('change', event => { settings.pictures = event.target.checked; persistSettings(); renderPractice(); });
  document.querySelector('#articles').addEventListener('change', event => { settings.articles = event.target.checked; persistSettings(); });
  document.querySelector('#new-round').addEventListener('click', () => startRound());
  document.querySelector('#search').addEventListener('input', renderWordBook);
  document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
}

async function init() {
  try {
    const response = await fetch('./vocabulary.json');
    if (!response.ok) throw new Error('Vocabulary file not found.');
    words = await response.json();
    settings.section = lessonData.some(lesson => lesson.id === settings.section) ? settings.section : 'all';
    renderLessons(); initializeControls(); updateGrowth(); startRound();
  } catch (error) {
    document.querySelector('#practice-content').innerHTML = '<div class="empty-state"><h2>Could not load the word list.</h2><p>' + escapeHtml(error.message) + ' Try opening the site again once the page has fully loaded.</p></div>';
  }
}
init();

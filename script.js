/* ============================================================
   SudokuX — Premium Sudoku Puzzle Generator
   script.js  |  Pure Vanilla JavaScript
   ============================================================ */

'use strict';

// ── Constants ──────────────────────────────────────────────────
const DIFFICULTY_CLUES = { easy: 36, medium: 28, hard: 22 };
const STORAGE_KEY      = 'sudokux_save';
const SOUND_KEY        = 'sudokux_sound';
const THEME_KEY        = 'sudokux_theme';

// ── State Object ───────────────────────────────────────────────
const state = {
  puzzle:      Array(81).fill(0),   // puzzle shown to user (0 = empty)
  solution:    Array(81).fill(0),   // full solved grid
  userGrid:    Array(81).fill(0),   // user's current answers
  given:       Array(81).fill(false), // which cells are pre-filled
  difficulty:  'easy',
  selected:    -1,                  // index of selected cell (-1 = none)
  mistakes:    0,
  hintsUsed:   0,
  timerSeconds: 0,
  timerInterval: null,
  solved:      false,
  soundOn:     true,
};

// ── Audio Context (Web Audio API for sound effects) ────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/**
 * Play a short synthetic tone.
 * @param {number} freq   - Frequency in Hz
 * @param {number} dur    - Duration in seconds
 * @param {'sine'|'square'} type - Waveform type
 * @param {number} vol    - Volume 0-1
 */
function playTone(freq, dur, type = 'sine', vol = 0.18) {
  if (!state.soundOn) return;
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch (_) { /* AudioContext blocked — silently skip */ }
}

const SFX = {
  place:   () => playTone(520, 0.08, 'sine', 0.12),
  error:   () => playTone(180, 0.25, 'square', 0.15),
  erase:   () => playTone(300, 0.06, 'sine', 0.08),
  win:     () => { playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 150); setTimeout(() => playTone(784, 0.3), 300); },
  hint:    () => playTone(440, 0.12, 'sine', 0.10),
  click:   () => playTone(600, 0.05, 'sine', 0.07),
};

// ── DOM References ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const gridEl           = $('sudoku-grid');
const timerEl          = $('timer');
const mistakesEl       = $('mistakes-count');
const hintsEl          = $('hints-used');
const progressBar      = $('progress-bar');
const progressText     = $('progress-text');
const puzzleLabel      = $('puzzle-label');
const themeIcon        = $('theme-icon');
const soundIcon        = $('sound-icon');
const winModal         = $('win-modal');
const modalTime        = $('modal-time');
const modalDifficulty  = $('modal-difficulty');
const modalMistakes    = $('modal-mistakes');
const toastEl          = $('toast');
const confettiContainer= $('confetti-container');

// ── 1. Sudoku Generator ────────────────────────────────────────

/** Fisher-Yates shuffle in place. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Check if placing `num` at `index` is valid in `grid` (array of 81).
 * Skips the cell at `index` itself so a placed value doesn't conflict
 * with its own position when validating.
 */
function isValid(grid, index, num) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;

  for (let i = 0; i < 9; i++) {
    const rowIdx = row * 9 + i;
    if (rowIdx !== index && grid[rowIdx] === num) return false;   // row conflict

    const colIdx = i * 9 + col;
    if (colIdx !== index && grid[colIdx] === num) return false;   // col conflict

    const r = boxRow + Math.floor(i / 3);
    const c = boxCol + (i % 3);
    const boxIdx = r * 9 + c;
    if (boxIdx !== index && grid[boxIdx] === num) return false;   // box conflict
  }
  return true;
}

/**
 * Backtracking solver — fills `grid` in place.
 * @param {number[]} grid - Array of 81 numbers (0 = empty)
 * @param {boolean} randomize - If true, shuffle candidates for generation
 * @returns {boolean} True if solved
 */
function solve(grid, randomize = false) {
  const empty = grid.indexOf(0);
  if (empty === -1) return true;   // all filled → solved

  const candidates = [1,2,3,4,5,6,7,8,9];
  if (randomize) shuffle(candidates);

  for (const num of candidates) {
    if (isValid(grid, empty, num)) {
      grid[empty] = num;
      if (solve(grid, randomize)) return true;
      grid[empty] = 0;              // backtrack
    }
  }
  return false;
}

/**
 * Count the number of solutions (capped at 2 for efficiency).
 * Used to ensure the puzzle has a unique solution.
 */
function countSolutions(grid, limit = 2) {
  const empty = grid.indexOf(0);
  if (empty === -1) return 1;
  let count = 0;
  for (let num = 1; num <= 9; num++) {
    if (isValid(grid, empty, num)) {
      grid[empty] = num;
      count += countSolutions(grid, limit);
      grid[empty] = 0;
      if (count >= limit) return count;
    }
  }
  return count;
}

/**
 * Generate a fully solved Sudoku grid.
 * @returns {number[]} Array of 81 filled numbers
 */
function generateSolution() {
  const grid = Array(81).fill(0);
  solve(grid, true);
  return grid;
}

/**
 * Create a puzzle by removing numbers from a solution while
 * maintaining a unique solution.
 * @param {number[]} solution - Full solved grid
 * @param {number} clues      - How many cells to KEEP visible
 * @returns {number[]} Puzzle grid (0 = hidden)
 */
function createPuzzle(solution, clues) {
  const puzzle    = [...solution];
  const positions = shuffle([...Array(81).keys()]); // random removal order
  let removed     = 0;
  const target    = 81 - clues;

  for (const pos of positions) {
    if (removed >= target) break;
    const backup = puzzle[pos];
    puzzle[pos]  = 0;

    // Verify unique solution after removal
    const testGrid = [...puzzle];
    if (countSolutions(testGrid) === 1) {
      removed++;
    } else {
      puzzle[pos] = backup; // restore — removal breaks uniqueness
    }
  }
  return puzzle;
}

// ── 2. Game Initialization ─────────────────────────────────────

/** Start a brand-new game with the current difficulty. */
function newGame() {
  stopTimer();
  state.solved      = false;
  state.mistakes    = 0;
  state.hintsUsed   = 0;
  state.timerSeconds= 0;
  state.selected    = -1;

  // Generate solution + puzzle
  state.solution = generateSolution();
  state.puzzle   = createPuzzle(state.solution, DIFFICULTY_CLUES[state.difficulty]);
  state.userGrid = [...state.puzzle];
  state.given    = state.puzzle.map(v => v !== 0);

  renderGrid();
  updateStats();
  updateProgress();
  startTimer();
  updatePuzzleLabel();
  saveProgress();
  SFX.click();
  showToast(`New ${capitalize(state.difficulty)} puzzle started!`, 'info');
}

/** Restart the current puzzle (clear user input, keep given cells). */
function restartPuzzle() {
  stopTimer();
  state.userGrid    = [...state.puzzle];
  state.mistakes    = 0;
  state.hintsUsed   = 0;
  state.timerSeconds= 0;
  state.solved      = false;
  state.selected    = -1;
  renderGrid();
  updateStats();
  updateProgress();
  startTimer();
  saveProgress();
  SFX.click();
  showToast('Puzzle restarted!', 'info');
}

// ── 3. Grid Rendering ──────────────────────────────────────────

/** Build all 81 cell elements and attach events. */
function buildGrid() {
  gridEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('data-index', i);
    cell.setAttribute('aria-label', `Row ${Math.floor(i/9)+1} Column ${(i%9)+1}`);
    cell.addEventListener('click',   () => selectCell(i));
    cell.addEventListener('keydown', (e) => handleCellKeydown(e, i));
    gridEl.appendChild(cell);
  }
}

/** Re-render all cells from state. */
function renderGrid() {
  const cells = gridEl.querySelectorAll('.cell');
  cells.forEach((cell, i) => {
    cell.className = 'cell'; // reset classes
    cell.textContent = '';

    const value = state.userGrid[i];
    if (state.given[i]) {
      cell.classList.add('given');
      cell.textContent = value;
      cell.removeAttribute('tabindex');
    } else {
      cell.setAttribute('tabindex', '0');
      if (value !== 0) {
        cell.textContent = value;
        cell.classList.add('user-filled');
        // Mark errors
        if (!isValid(state.userGrid, i, value) || value !== state.solution[i]) {
          cell.classList.add('error');
        }
      }
    }
  });
  applyHighlights();
}

/**
 * Highlight selected cell, same-row/col/box cells, and same-number cells.
 */
function applyHighlights() {
  if (state.selected === -1) return;
  const cells   = gridEl.querySelectorAll('.cell');
  const sel     = state.selected;
  const selRow  = Math.floor(sel / 9);
  const selCol  = sel % 9;
  const selVal  = state.userGrid[sel];
  const boxR    = Math.floor(selRow / 3) * 3;
  const boxC    = Math.floor(selCol / 3) * 3;

  cells.forEach((cell, i) => {
    if (i === sel) { cell.classList.add('selected'); return; }
    const r = Math.floor(i / 9), c = i % 9;
    const inBox = r >= boxR && r < boxR+3 && c >= boxC && c < boxC+3;
    if (r === selRow || c === selCol || inBox) cell.classList.add('highlighted');
    if (selVal !== 0 && state.userGrid[i] === selVal) cell.classList.add('same-number');
  });
}

// ── 4. Cell Selection & Input ──────────────────────────────────

function selectCell(index) {
  if (state.solved) return;
  state.selected = index;
  renderGrid();
  SFX.click();
}

/** Place a number in the selected cell. */
function placeNumber(num) {
  const idx = state.selected;
  if (idx === -1 || state.given[idx] || state.solved) return;

  // Track whether the cell previously had a wrong answer
  const prevWasWrong = state.userGrid[idx] !== 0 && state.userGrid[idx] !== state.solution[idx];

  if (num === 0) {
    // Erase
    state.userGrid[idx] = 0;
    SFX.erase();
  } else {
    state.userGrid[idx] = num;
    // Real-time validation — only count a new mistake if the old
    // value wasn't already wrong (avoids double-counting on overwrite)
    if (num !== state.solution[idx]) {
      if (!prevWasWrong) state.mistakes++;
      updateStats();
      SFX.error();
    } else {
      SFX.place();
      flashCellCorrect(idx);
    }
  }

  renderGrid();
  updateProgress();
  saveProgress();

  if (checkWin()) handleWin();
}

function flashCellError(idx) {
  const cell = gridEl.querySelector(`[data-index="${idx}"]`);
  if (!cell) return;
  cell.classList.add('error');
}

function flashCellCorrect(idx) {
  const cell = gridEl.querySelector(`[data-index="${idx}"]`);
  if (!cell) return;
  cell.classList.add('correct-flash');
  cell.addEventListener('animationend', () => cell.classList.remove('correct-flash'), { once: true });
}

/** Keyboard: arrow keys to navigate, digits to input. */
function handleCellKeydown(e, index) {
  if (state.solved) return;
  const key = e.key;
  const ARROWS = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };

  if (key in ARROWS) {
    e.preventDefault();
    const next = index + ARROWS[key];
    if (next >= 0 && next < 81) {
      state.selected = next;
      gridEl.querySelectorAll('.cell')[next].focus();
      renderGrid();
    }
    return;
  }

  if (key >= '1' && key <= '9') { selectCell(index); placeNumber(parseInt(key)); return; }
  if (key === 'Backspace' || key === 'Delete' || key === '0') { selectCell(index); placeNumber(0); return; }
}

// ── 5. Hint System ─────────────────────────────────────────────

/** Reveal one empty cell from the solution. */
function giveHint() {
  if (state.solved) return;
  // Find all empty non-given cells
  const empties = [];
  for (let i = 0; i < 81; i++) {
    if (!state.given[i] && state.userGrid[i] === 0) empties.push(i);
  }
  if (empties.length === 0) { showToast('No empty cells left!', 'info'); return; }

  const idx = empties[Math.floor(Math.random() * empties.length)];
  state.userGrid[idx] = state.solution[idx];
  state.given[idx]    = true; // treat as given so it can't be edited
  state.hintsUsed++;
  updateStats();
  renderGrid();
  updateProgress();
  saveProgress();
  SFX.hint();
  showToast('Hint revealed!', 'info');
  if (checkWin()) handleWin();
}

// ── 6. Validation ──────────────────────────────────────────────

/** Check if every cell equals the solution. */
function checkWin() {
  return state.userGrid.every((v, i) => v === state.solution[i]);
}

/** "Check Solution" button — highlight all errors. */
function checkSolution() {
  if (state.solved) return;
  let hasError = false;
  const cells  = gridEl.querySelectorAll('.cell');

  state.userGrid.forEach((val, i) => {
    if (!state.given[i] && val !== 0 && val !== state.solution[i]) {
      cells[i].classList.add('error');
      hasError = true;
    }
  });

  if (hasError) {
    SFX.error();
    showToast('Some cells are incorrect — highlighted in red!', 'error-toast');
  } else {
    SFX.place();
    showToast('Looking great — no errors found!', 'success');
  }
}

// ── 7. Win Handler ─────────────────────────────────────────────

function handleWin() {
  state.solved = true;
  stopTimer();
  SFX.win();
  spawnConfetti(120);

  modalTime.textContent       = formatTime(state.timerSeconds);
  modalDifficulty.textContent = capitalize(state.difficulty);
  modalMistakes.textContent   = state.mistakes;

  const msgs = [
    'Brilliant performance! 🌟',
    'You crushed it! 💪',
    'Flawless logic! 🧠',
    'A true Sudoku master! 🏅',
    'Outstanding puzzle-solving! ✨',
  ];
  document.getElementById('win-message').textContent = msgs[Math.floor(Math.random() * msgs.length)];

  winModal.classList.remove('hidden');
  clearProgress(); // wipe saved state
}

// ── 8. Confetti ────────────────────────────────────────────────

const CONFETTI_COLORS = ['#7c6cf8','#06b6d4','#f472b6','#34d399','#fbbf24','#f87171','#a78bfa'];

function spawnConfetti(count = 80) {
  confettiContainer.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.classList.add('confetti-piece');
    const color  = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const left   = Math.random() * 100;
    const delay  = Math.random() * 1.5;
    const dur    = 2 + Math.random() * 2.5;
    const size   = 6 + Math.random() * 8;
    const rotate = Math.random() * 360;
    piece.style.cssText = `
      left:${left}%;background:${color};
      width:${size}px;height:${size}px;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration:${dur}s;animation-delay:${delay}s;
      transform:rotate(${rotate}deg);
    `;
    confettiContainer.appendChild(piece);
  }
  // Clean up after animations finish
  setTimeout(() => { confettiContainer.innerHTML = ''; }, 5500);
}

// ── 9. Timer ───────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  state.timerInterval = setInterval(() => {
    state.timerSeconds++;
    timerEl.textContent = formatTime(state.timerSeconds);
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── 10. UI Updaters ────────────────────────────────────────────

function updateStats() {
  mistakesEl.textContent = state.mistakes;
  hintsEl.textContent    = state.hintsUsed;
}

function updateProgress() {
  const filled = state.userGrid.filter(v => v !== 0).length;
  const pct    = Math.round((filled / 81) * 100);
  progressBar.style.width         = pct + '%';
  progressText.textContent        = `${filled} / 81`;
  progressBar.closest('[role="progressbar"]').setAttribute('aria-valuenow', filled);
}

function updatePuzzleLabel() {
  puzzleLabel.textContent = `${capitalize(state.difficulty)} Puzzle`;
}

// ── 11. Toast ──────────────────────────────────────────────────

let toastTimer = null;
/**
 * Show a temporary toast notification.
 * @param {string} msg   - Message text
 * @param {string} type  - 'success' | 'error-toast' | 'info'
 */
function showToast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type}`;
  // Force reflow so CSS transition fires even on repeated calls
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.classList.add('hidden'); }, 400);
  }, 2600);
}

// ── 12. Theme Toggle ───────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
  SFX.click();
}

// ── 13. Sound Toggle ───────────────────────────────────────────

function toggleSound() {
  state.soundOn      = !state.soundOn;
  soundIcon.textContent = state.soundOn ? '🔊' : '🔇';
  localStorage.setItem(SOUND_KEY, state.soundOn ? '1' : '0');
}

// ── 14. Difficulty Selection ───────────────────────────────────

function setDifficulty(diff) {
  state.difficulty = diff;
  document.querySelectorAll('.diff-btn').forEach(btn => {
    const isActive = btn.dataset.difficulty === diff;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });
  SFX.click();
}

// ── 15. localStorage Save / Load ───────────────────────────────

function saveProgress() {
  if (state.solved) return; // nothing to save after winning
  const data = {
    puzzle:       state.puzzle,
    solution:     state.solution,
    userGrid:     state.userGrid,
    given:        state.given,
    difficulty:   state.difficulty,
    mistakes:     state.mistakes,
    hintsUsed:    state.hintsUsed,
    timerSeconds: state.timerSeconds,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  // Flash saved indicator briefly
  const indicator = document.getElementById('saved-indicator');
  if (indicator) {
    indicator.style.opacity = '1';
    setTimeout(() => { indicator.style.opacity = '0.5'; }, 800);
  }
}

function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    Object.assign(state, {
      puzzle:       data.puzzle,
      solution:     data.solution,
      userGrid:     data.userGrid,
      given:        data.given,
      difficulty:   data.difficulty  || 'easy',
      mistakes:     data.mistakes    || 0,
      hintsUsed:    data.hintsUsed   || 0,
      timerSeconds: data.timerSeconds|| 0,
    });
    return true;
  } catch (_) { return false; }
}

function clearProgress() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── 16. Utility ────────────────────────────────────────────────

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

// ── 17. Event Listeners ────────────────────────────────────────

function bindEvents() {
  // Difficulty buttons
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setDifficulty(btn.dataset.difficulty);
      newGame();
    });
  });

  // Number pad
  document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => placeNumber(parseInt(btn.dataset.num)));
  });

  // Action buttons
  $('btn-hint')     .addEventListener('click', giveHint);
  $('btn-check')    .addEventListener('click', checkSolution);
  $('btn-restart')  .addEventListener('click', restartPuzzle);
  $('btn-new-game') .addEventListener('click', newGame);
  $('modal-new-game').addEventListener('click', () => {
    winModal.classList.add('hidden');
    newGame();
  });

  // Theme & sound
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('sound-toggle').addEventListener('click', toggleSound);

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('cell')) return; // handled by cell
    if (e.key >= '1' && e.key <= '9') placeNumber(parseInt(e.key));
    if (e.key === 'Backspace' || e.key === 'Delete') placeNumber(0);
    if (e.key === 'Escape') { state.selected = -1; renderGrid(); }
  });

  // Click outside grid to deselect
  document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('cell') && !e.target.classList.contains('num-btn')) {
      if (state.selected !== -1) { state.selected = -1; renderGrid(); }
    }
  });

  // Auto-save every 10 seconds
  setInterval(saveProgress, 10000);

  // Save on page unload
  window.addEventListener('beforeunload', saveProgress);
}

// ── 18. Bootstrap ──────────────────────────────────────────────

function init() {
  // Restore theme
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  // Restore sound preference
  const savedSound = localStorage.getItem(SOUND_KEY);
  if (savedSound === '0') { state.soundOn = false; soundIcon.textContent = '🔇'; }

  // Build the grid DOM once
  buildGrid();

  // Try to restore saved game; otherwise start fresh
  const restored = loadProgress();
  if (restored) {
    setDifficulty(state.difficulty);
    updatePuzzleLabel();
    renderGrid();
    updateStats();
    updateProgress();
    timerEl.textContent = formatTime(state.timerSeconds);
    startTimer();
    showToast('Welcome back! Progress restored 🎉', 'success');
  } else {
    setDifficulty('easy');
    newGame();
  }

  bindEvents();
}

// Run after DOM is ready
document.addEventListener('DOMContentLoaded', init);

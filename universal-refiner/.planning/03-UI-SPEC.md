---
status: draft
phase: 3
name: Auto-Pilot Dashboard Improvements
---

# UI Specification: Intelligence Hub Dashboard

## 1. Vision & Goals
Transform the dashboard into a visually striking, reactive "Intelligence Hub" that provides real-time feedback on autonomous processes.

## 2. Spacing & Layout
- **Scale**: Multiples of 4px (4, 8, 12, 16, 20, 24, 32, 48, 64).
- **Pulse Bar**:
  - Position: Top-center of the `.main-container`.
  - Type: Absolute positioned, floating 16px from the top.
  - Height: 36px.
  - Padding: 0 16px.
  - Border-radius: 18px (pill shape).
  - Background: `rgba(15, 23, 42, 0.8)` with `backdrop-filter: blur(10px)`.
- **Sidebar Cleanup**:
  - `project-list`: Add `padding-right: 12px` to prevent scrollbar overlap with text.
  - `project-item`: Increase vertical gap to 4px.
  - Ensure `.main-container` has `padding-top: 64px` to accommodate the floating Pulse Bar.

## 3. Typography
- **Primary Font**: `Inter`, system-ui, sans-serif.
- **Sizes**:
  - **Status Labels**: 11px (0.6875rem) - All caps, letter-spacing 0.05em.
  - **Body/Nav**: 13px (0.8125rem).
  - **Sub-headers**: 14px (0.875rem) - Semi-bold.
  - **Headers**: 20px (1.25rem) - Bold.
- **Weights**: 
  - Regular (400)
  - Medium (500)
  - Bold (700)
- **Line Heights**:
  - Body: 1.5
  - Heading: 1.2

## 4. Color Palette
- **Dominant Surface (60%)**: `#020617` (Deep space blue).
- **Secondary Surface (30%)**: `rgba(15, 23, 42, 0.9)` (Sidebar/Cards).
- **Accent (10%)**: `#38bdf8` (Electric blue) - Reserved for:
  - Active status dots.
  - Animation glows.
  - Active navigation items.
- **Semantic Colors**:
  - `success`: `#22c55e` (Green) - Connected status, Successful sync.
  - `warning`: `#eab308` (Yellow) - Sync in progress.
  - `destructive`: `#ef4444` (Red) - Error states, Dismiss action.

## 5. Components & Interactions

### 5.1 Pulse Bar (New)
A horizontal pill-shaped container containing the following status groups:
1. **CONNECTED**: Dot (Green) + Label "CONNECTED".
2. **AUTO-PILOT**: Dot (Blue) + Label "AUTO-PILOT".
3. **ATLASSIAN SYNC**: Icon (Cloud/Gear) + Label "ATLASSIAN SYNC".

### 5.2 Animations
- **`pulse-glow`**:
  - Trigger: Breathing animation applied to the dot or icon.
  - Keyframes:
    - `0%`: `box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.7)`.
    - `70%`: `box-shadow: 0 0 0 10px rgba(56, 189, 248, 0)`.
    - `100%`: `box-shadow: 0 0 0 0 rgba(56, 189, 248, 0)`.
- **Consumption Consumption Triggers**:
  - **AUTO-PILOT Pulse**: Triggered when a new commit is detected in the stream.
  - **CONNECTED Pulse**: Triggered when a new refinement event is detected in the stream.
- **`rotate-gear`**: 
  - Trigger: Applied to the Atlassian icon during sync.
  - Keyframes: `transform: rotate(360deg)` infinite 2s linear.

### 5.3 Atlassian Sync States
| State | Icon | Text | Color |
|-------|------|------|-------|
| **IDLE** | `cloud` | ATLASSIAN SYNC | `--text-secondary` |
| **SYNCING** | `settings` (Rotating) | SYNCING... | `--accent-blue` |
| **SUCCESS** | `cloud-check` | SYNC COMPLETE | `--success` |
| **ERROR** | `cloud-off` | SYNC FAILED | `--destructive` |

## 6. Copywriting
- **Primary CTA**: "SYNC NOW" (Header).
- **Secondary CTA**: "APPROVE MANDATE" (Cards).
- **Destructive**: "DISMISS" (Cards).
- **Empty State**: "No intelligence events detected yet."
- **Error state**: "Dashboard state unavailable. Check connection."

## 7. Registry & Assets
- **Icon Library**: [Lucide](https://lucide.dev/).
- **Charts**: [Chart.js](https://www.chartjs.org/).
- **Registry**: None (Standard HTML/JS).

## 8. Safety Gate
- **Third-party usage**: CDN for Lucide and Chart.js (Approved).
- **Network**: Dashboard uses standard fetch to internal `/api` routes only.

// The single source of truth for "which action is done how". The guide's controls table, the tooltips and the tests all
// read it, so what the guide says can never drift from what the app does.
//   hand: 'draw' = the drawing hand (cyan), 'nav' = the navigation hand (magenta), 'both', or null (no hand needed)

export const CONTROLS = [
  { id: 'draw', action: 'Draw a curve', hand: 'draw', gesture: 'Pinch thumb + index, then move', key: '1', button: 'Freehand' },
  { id: 'place', action: 'Place a shape (line, rectangle, circle, cube, sphere, cylinder, cone, pyramid)', hand: 'draw', gesture: 'Pinch at the centre, drag outward, release', key: '2 – 9', button: 'Top bar' },
  { id: 'grab', action: 'Move an object', hand: 'draw', gesture: 'Pinch thumb + middle finger, then move', key: '0', button: 'Move' },
  { id: 'scale', action: 'Resize an object', hand: 'draw', gesture: 'Scale tool: pinch it, drag up or down', key: 'X', button: 'Scale' },
  { id: 'extrude', action: 'Extrude a closed outline into a solid', hand: 'draw', gesture: 'Extrude tool: pinch inside the outline, drag up to pull it out (down pushes the other way)', key: 'Q', button: 'Extrude' },
  { id: 'cut', action: 'Cut a pocket or hole into a solid', hand: 'draw', gesture: 'Cut tool: pinch inside an outline drawn over the solid, drag up to set the depth', key: 'K', button: 'Cut' },
  { id: 'point', action: 'Choose a button without pinching', hand: 'draw', gesture: 'Point with the index finger (others curled) at a button and hold for a moment: a ring fills, then it is pressed', key: '', button: 'any button' },
  { id: 'press', action: 'Press a button', hand: 'draw', gesture: 'Pinch while pointing at it', key: '', button: 'any button' },
  { id: 'orbit', action: 'Orbit the camera', hand: 'nav', gesture: 'Fist, then move', key: '', button: '' },
  { id: 'pan', action: 'Pan the camera', hand: 'nav', gesture: 'Peace sign (index + middle up), then move', key: '', button: '' },
  { id: 'zoom', action: 'Zoom', hand: 'both', gesture: 'Pinch with both hands, move them apart or together', key: '+ −', button: '' },
  { id: 'join', action: 'Join / stitch lines', hand: null, gesture: 'After a freehand stroke a prompt asks: pinch “Join”', key: 'J', button: 'Join lines' },
  { id: 'mode', action: 'Switch between 3D Sketch and 3-Plane Hull', hand: null, gesture: '', key: 'P', button: 'Mode switch at the top' },
  { id: 'planes', action: 'Draw outlines in the Front, Side and Top cells', hand: 'draw', gesture: 'Pinch inside a cell and draw; the 3D preview builds itself', key: 'U', button: 'Make 3D' },
  { id: 'refimage', action: 'Trace over a photo in a view', hand: 'draw', gesture: 'Add photo on the view, press Trace, then draw over it with Freehand', key: '', button: 'View toolbar: Add photo · Trace · ✥ (drag to move, wheel to resize) · − + · ◐ · ⇋ · ✕' },
  { id: 'photo', action: 'Make a 3D shape from photos', hand: null, gesture: 'Add photo on two or three views: the outline is found automatically', key: 'U', button: 'View toolbar: Add photo · Auto · Object: Auto / Dark / Light, then Make 3D' },
  { id: 'views', action: 'Look straight at the Front, Side or Top', hand: null, gesture: '', key: 'F · L · T', button: 'Visual hull panel' },
  { id: 'hull', action: 'Make a 3D shape from outlines (visual hull)', hand: null, gesture: 'Draw closed outlines in two or three views, then press Make 3D', key: 'U', button: 'Visual hull' },
  { id: 'undo', action: 'Undo', hand: null, gesture: '', key: 'Z', button: 'Undo' },
  { id: 'clear', action: 'Clear the scene', hand: null, gesture: '', key: 'C', button: 'Clear scene' },
  { id: 'models', action: 'Test the hand and arm models on this computer (speed and detection)', hand: null, gesture: 'Press Models in the top bar, then Test', key: 'M', button: 'Models' },
  { id: 'demo', action: 'Try a ready-made demo (rocket, house, vase, head)', hand: null, gesture: 'Press Demo in the top bar, then a card', key: 'O', button: 'Demo' },
  { id: 'photos', action: 'Make a 3D model from photos (front / side / top)', hand: null, gesture: 'Drag photos onto the window', key: '', button: 'Photos → 3D' },
  { id: 'import', action: 'Import a model', hand: null, gesture: 'Drag a file onto the page', key: 'I', button: 'Import model' },
  { id: 'export', action: 'Export (OBJ / STL)', hand: null, gesture: '', key: 'E', button: 'Export OBJ / STL' },
  { id: 'depth', action: 'Drawing depth', hand: null, gesture: '', key: '[  ]', button: 'Depth − / +' },
  { id: 'view', action: 'Reset the view', hand: null, gesture: '', key: 'V', button: 'Reset view' },
  { id: 'swap', action: 'Swap drawing and navigation hands', hand: null, gesture: '', key: 'H', button: 'Settings' },
];

/** Name of the physical hand that does `role` ('draw' | 'nav') given the user's drawing hand. */
export function handName(role, dominant) {
  if (role === 'both') return 'Both hands';
  if (role === 'draw') return `${dominant} hand`;
  if (role === 'nav') return `${dominant === 'Left' ? 'Right' : 'Left'} hand`;
  return '';
}

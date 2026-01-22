/**
 * Small Gods - Input Manager
 *
 * Centralized input handling with unified coordinate conversion.
 */

import { screenToCanvas, canvasToTile, isInCanvas, isInMap } from '../core/coordinates';
import { AI_SIZE } from '../core/constants';
import type { GameState, Point } from '../types';

export type ClickCallback = (canvasX: number, canvasY: number, tileX: number, tileY: number) => void;
export type MoveCallback = (canvasX: number, canvasY: number, tileX: number | null, tileY: number | null) => void;
export type DragCallback = (dx: number, dy: number) => void;
export type ZoomCallback = (delta: number, centerX: number, centerY: number) => void;

export interface InputManagerConfig {
  container: HTMLElement;
  state: GameState;
  onClick?: ClickCallback;
  onMove?: MoveCallback;
  onDrag?: DragCallback;
  onZoom?: ZoomCallback;
  dragThreshold?: number;
}

export class InputManager {
  private container: HTMLElement;
  private state: GameState;
  private onClick?: ClickCallback;
  private onMove?: MoveCallback;
  private onDrag?: DragCallback;
  private onZoom?: ZoomCallback;
  private dragThreshold: number;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(config: InputManagerConfig) {
    this.container = config.container;
    this.state = config.state;
    this.onClick = config.onClick;
    this.onMove = config.onMove;
    this.onDrag = config.onDrag;
    this.onZoom = config.onZoom;
    this.dragThreshold = config.dragThreshold ?? 5;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.container.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.container.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.container.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.container.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
  }

  private getCanvasCoords(e: MouseEvent): Point {
    const rect = this.container.getBoundingClientRect();
    return screenToCanvas(e.clientX, e.clientY, this.state.camera, rect);
  }

  private getTileCoords(canvasX: number, canvasY: number): Point | null {
    if (!this.state.map || !isInCanvas(canvasX, canvasY)) {
      return null;
    }
    const tile = canvasToTile(canvasX, canvasY, this.state.map);
    if (!isInMap(tile.x, tile.y, this.state.map)) {
      return null;
    }
    return tile;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.onZoom) {
      const canvas = this.getCanvasCoords(e);
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.onZoom(delta, canvas.x, canvas.y);
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 0) {
      this.state.camera.dragging = true;
      this.state.camera.lastX = e.clientX;
      this.state.camera.lastY = e.clientY;
      this.state.camera.startX = e.clientX;
      this.state.camera.startY = e.clientY;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.isDragging = false;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const canvas = this.getCanvasCoords(e);
    const tile = this.getTileCoords(canvas.x, canvas.y);

    // Call move callback
    if (this.onMove) {
      this.onMove(canvas.x, canvas.y, tile?.x ?? null, tile?.y ?? null);
    }

    // Handle dragging
    if (this.state.camera.dragging) {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;

      if (Math.abs(dx) > this.dragThreshold || Math.abs(dy) > this.dragThreshold) {
        this.isDragging = true;
        this.container.style.cursor = 'grabbing';
      }

      if (this.onDrag) {
        const moveDx = (e.clientX - this.state.camera.lastX) / this.state.camera.zoom;
        const moveDy = (e.clientY - this.state.camera.lastY) / this.state.camera.zoom;
        this.onDrag(moveDx, moveDy);
      }

      this.state.camera.lastX = e.clientX;
      this.state.camera.lastY = e.clientY;
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    const wasDrag = this.isDragging;
    this.state.camera.dragging = false;
    this.isDragging = false;
    this.container.style.cursor = 'default';

    // Only trigger click if it wasn't a drag
    if (!wasDrag && this.onClick && this.state.map) {
      const canvas = this.getCanvasCoords(e);
      if (isInCanvas(canvas.x, canvas.y)) {
        const tile = canvasToTile(canvas.x, canvas.y, this.state.map);
        this.onClick(canvas.x, canvas.y, tile.x, tile.y);
      }
    }
  }

  private handleMouseLeave(): void {
    this.state.camera.dragging = false;
    this.isDragging = false;
    this.container.style.cursor = 'default';
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.container.removeEventListener('wheel', this.handleWheel.bind(this));
    this.container.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    this.container.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    this.container.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    this.container.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
  }
}

import * as THREE from 'three';
import type { AppModel } from '../../app/model';
import { smoothstep } from '../../core/math';
import type { AthleteLayer } from '../athleteLayer';
import { BigScreen } from './bigScreen';
import { Confetti } from './confetti';
import { Crowd, type Spot } from './crowd';
import { type Frame, frameAt } from './frame';
import { boards, bunting, flagPoles, grandstand, lineOfSpectators, startHut, tent } from './props';

const NEAR = 35, FAR_AREA = 130, FAR_JUMP = 90;     // m: full cheering inside NEAR, none beyond the zone radius
const FINISH_TRIGGER = 4;                           // m before the line at which the confetti goes off
const ZONE = { finish: 0, start: 1, firstJump: 2 };

/**
 * The atmosphere around the course: grandstands and spectators at the start and the finish, a few groups at the
 * jumps, boards, bunting, flags, tents, a start hut, and a big LED screen. Spectators cheer when athletes come
 * close, and confetti goes off when someone finishes.
 */
export class Venue {
  readonly object = new THREE.Group();
  private readonly crowd: Crowd;
  private readonly screen: BigScreen;
  private readonly confetti = new Confetti();
  private readonly zones: { centre: THREE.Vector3; radius: number }[] = [];
  private readonly finishFrame: Frame;
  private readonly lastChainage = new Map<number, number>();

  constructor(private model: AppModel, private athletes: () => AthleteLayer) {
    const course = model.world.course, spots: Spot[] = [];
    const nations = [...new Set([...model.world.athletes.map((a) => a.nation), 'ITA', 'GER', 'SWE'])];   // competitors first, then a few others
    const finish = this.finishFrame = frameAt(course, course.length), start = frameAt(course, 0);
    this.zones[ZONE.finish] = { centre: finish.at(-15, 0), radius: FAR_AREA };
    this.zones[ZONE.start] = { centre: start.at(10, 0), radius: FAR_AREA };

    // --- finish area ---------------------------------------------------------------------------------
    for (const side of [-1, 1] as const) {
      const stand = grandstand(finish, { side, from: -75, to: 25, steps: 4, group: ZONE.finish, seed: 20 + side });
      this.object.add(stand.object);
      spots.push(...stand.spots, ...lineOfSpectators(finish, side, -80, 30, 1.6, ZONE.finish, 30 + side));
    }
    this.object.add(boards(finish, -85, 30, 14, 3), flagPoles(finish, -80, 30, 22, nations),
      bunting(finish, -40), bunting(finish, -12), bunting(finish, 14));
    this.addAll(tent(finish, 15, -38, 0xff7a1a), tent(finish, 15, 38, 0x38bdf8), tent(finish, 36, -36, 0xe8566b), tent(finish, 36, 36, 0xf6c945));
    this.screen = new BigScreen(finish, 62, model);
    this.object.add(this.screen.object);

    // --- start area ----------------------------------------------------------------------------------
    for (const side of [-1, 1] as const) {
      const stand = grandstand(start, { side, from: 0, to: 40, steps: 2, group: ZONE.start, fill: 0.7, seed: 40 + side });
      this.object.add(stand.object);
      spots.push(...stand.spots, ...lineOfSpectators(start, side, -20, 45, 2.2, ZONE.start, 50 + side));
    }
    this.object.add(boards(start, -10, 40, 18, 6), flagPoles(start, -10, 40, 25, nations), bunting(start, 14));
    this.addAll(startHut(start, -6, -24), tent(start, 22, 30, 0x38bdf8));

    // --- a few groups at the jumps --------------------------------------------------------------------
    course.features.forEach((feature, i) => {
      const frame = frameAt(course, feature.s);
      this.zones[ZONE.firstJump + i] = { centre: frame.at(0, 0), radius: FAR_JUMP };
      for (const side of [-1, 1] as const) spots.push(...lineOfSpectators(frame, side, -22, 22, 3.2, ZONE.firstJump + i, 60 + i * 2 + side));
    });

    this.crowd = new Crowd(spots);
    this.object.add(this.crowd.object, this.confetti.points);
  }

  /** Adds the objects that could be placed; a tent or hut that would have stood on the piste comes back as null. */
  private addAll(...objects: (THREE.Object3D | null)[]): void {
    for (const object of objects) if (object) this.object.add(object);
  }

  /** How worked up each zone is: closer athletes mean louder, bouncier spectators. */
  private excitement(): number[] {
    const positions = this.model.visibleRuns.map((r) => this.athletes().positionOf(r.bib));
    return this.zones.map((zone) => {
      const nearest = Math.min(...positions.map((p) => p.distanceTo(zone.centre)));
      return 1 - smoothstep(NEAR, zone.radius, nearest);
    });
  }

  /** Confetti when an athlete's chainage crosses the trigger point (not when scrubbing past it backwards). */
  private checkFinish(): void {
    const threshold = this.model.world.course.length - FINISH_TRIGGER;
    for (const run of this.model.visibleRuns) {
      const now = this.model.sampleFor(run).s, before = this.lastChainage.get(run.bib);
      if (before !== undefined && before < threshold && now >= threshold && now - before < 60) this.confetti.burst(this.finishFrame.at(0, 0));
      this.lastChainage.set(run.bib, now);
    }
  }

  update(dt: number): void {
    this.object.visible = this.model.layers.venue;
    if (!this.object.visible) return;
    this.crowd.update(this.model.time, this.excitement());
    this.screen.update(dt);
    this.checkFinish();
    this.confetti.update(dt);
  }
}


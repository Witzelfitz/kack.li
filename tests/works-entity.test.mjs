import assert from 'node:assert/strict';
import { createWorksService } from '../services/works-service.js';

const rows = [
  {
    id: 1,
    title: 'Episode A',
    pub_date: '2026-01-01',
    pub_ts: 1735689600,
    film_title: 'Top Gun',
    manual_film_title: null,
  },
  {
    id: 2,
    title: 'Episode B',
    pub_date: '2026-02-01',
    pub_ts: 1738368000,
    film_title: 'Top Gun',
    manual_film_title: null,
  },
  {
    id: 3,
    title: 'Episode C',
    pub_date: '2026-03-01',
    pub_ts: 1740787200,
    film_title: null,
    manual_film_title: 'The Mask',
  },
  {
    id: 4,
    title: 'Episode D',
    pub_date: '2026-03-05',
    pub_ts: 1741132800,
    film_title: null,
    manual_film_title: null,
  },
];

const episodes = {
  worksRows() {
    return rows;
  },
};

const worksService = createWorksService({ episodes });

const list = worksService.listWorks({ limit: 50, offset: 0 });
assert.equal(list.total, 2);

const topGun = list.works.find((work) => work.title === 'Top Gun');
assert.ok(topGun);
assert.equal(topGun.id, 'work-top-gun');
assert.equal(topGun.episode_count, 2);

const detail = worksService.getWorkById('work-top-gun');
assert.ok(detail);
assert.equal(detail.episodes.length, 2);
assert.equal(detail.episodes[0].id, 2);

console.log('OK: Work-Entitäts-Test bestanden.');

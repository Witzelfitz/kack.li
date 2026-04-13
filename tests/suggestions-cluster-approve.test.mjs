import assert from 'node:assert/strict';
import {
  getEffectiveFilmTitle,
  getWorkIdFromFilmTitle,
  normalizeFilmTitle,
  normalizeGuestEntry,
  normalizeText,
  normalizeTopicEntry,
  tryJson,
  mergeStringArrays,
} from '../lib/episode-utils.js';
import { createSuggestionsService } from '../services/suggestions-service.js';

function createContext({ suggestionType, suggestionValue, episode }) {
  const calls = { updateManualArray: [], updateManualFilmTitle: [], markReviewed: [] };

  const episodes = {
    getById() {
      return episode;
    },
    updateManualArray(column, episodeId, values) {
      calls.updateManualArray.push({ column, episodeId, values });
    },
    updateManualFilmTitle(episodeId, value) {
      calls.updateManualFilmTitle.push({ episodeId, value });
    },
    worksRows() {
      return [
        { film_title: 'Star Wars', manual_film_title: null },
        { film_title: 'Star Wars', manual_film_title: null },
      ];
    },
  };

  const suggestions = {
    getById() {
      return {
        id: 101,
        episode_id: 7,
        suggestion_type: suggestionType,
        value: suggestionValue,
        status: 'pending',
      };
    },
    markReviewed(...args) {
      calls.markReviewed.push(args);
    },
  };

  const service = createSuggestionsService({
    episodes,
    suggestions,
    tryJson,
    mergeStringArrays,
    normalizeText,
    normalizeGuestEntry,
    normalizeTopicEntry,
    normalizeFilmTitle,
    getWorkIdFromFilmTitle,
    getEffectiveFilmTitle,
    log: () => {},
    saveDb: () => {},
  });

  return { service, calls };
}

{
  const episode = {
    guests_json: JSON.stringify(['Dag-Alexis Kopplin (Sänger der Band SDP)']),
    manual_guests_json: JSON.stringify([]),
  };
  const { service, calls } = createContext({
    suggestionType: 'guest',
    suggestionValue: 'Dag von SDP',
    episode,
  });

  const result = service.reviewSuggestion({ suggestionId: 101, action: 'approve' });
  assert.equal(result.ok, true);
  assert.equal(calls.updateManualArray.length, 0, 'guest alias should not be inserted twice');
}

{
  const episode = {
    topics_json: JSON.stringify(['Hörerfragen']),
    manual_topics_json: JSON.stringify([]),
  };
  const { service, calls } = createContext({
    suggestionType: 'topic',
    suggestionValue: 'Hörermails',
    episode,
  });

  const result = service.reviewSuggestion({ suggestionId: 101, action: 'approve' });
  assert.equal(result.ok, true);
  assert.equal(calls.updateManualArray.length, 0, 'topic alias should not be inserted twice');
}

{
  const episode = {
    film_title: 'Star Wars',
    manual_film_title: null,
  };
  const { service, calls } = createContext({
    suggestionType: 'film',
    suggestionValue: 'star wars',
    episode,
  });

  const result = service.reviewSuggestion({ suggestionId: 101, action: 'approve' });
  assert.equal(result.ok, true);
  assert.equal(calls.updateManualFilmTitle.length, 1, 'film should be written canonically');
  assert.equal(calls.updateManualFilmTitle[0].value, 'Star Wars');
}

console.log('OK: Suggestion-Cluster-Approve Tests bestanden.');

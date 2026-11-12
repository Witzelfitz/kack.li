export const TOPIC_MODEL = [
  {
    id: 'community-feedback',
    name: 'Community-Feedback',
    aliases: ['Hörerfeedback', 'Hörermails', 'Hörerfragen'],
  },
  {
    id: 'premium-kanal',
    name: 'Premium-Kanal',
    aliases: ['Premium Kanal', 'Premium-Kanal'],
  },
  {
    id: 'interpretation',
    name: 'Interpretation',
    aliases: ['Interpretationen', 'Filminterpretation', 'Interpretation'],
  },
  {
    id: 'filmanalyse',
    name: 'Filmanalyse',
    aliases: ['Film Analyse', 'Filmanalyse', 'Handlungsanalyse', 'Charakteranalyse', 'Filmvergleich'],
  },
  {
    id: 'filmproduktion',
    name: 'Filmproduktion',
    aliases: ['Filmproduktion', 'Dreharbeiten', 'Entstehungsgeschichte'],
  },
  {
    id: 'filmkritik',
    name: 'Filmkritik',
    aliases: ['Filmkritik', 'Kritik'],
  },
  {
    id: 'filme',
    name: 'Filme',
    aliases: ['Film', 'Filme'],
  },
  {
    id: 'theorien',
    name: 'Theorien',
    aliases: ['Theorien', 'Spekulationen', 'Fantheorien'],
  },
  {
    id: 'science-fiction',
    name: 'Science Fiction',
    aliases: ['Science Fiction', 'Science-Fiction', 'Sci-Fi', 'SciFi'],
  },
  {
    id: 'historische-hintergruende',
    name: 'Historische Hintergründe',
    aliases: ['historische Hintergründe', 'Historische Hintergründe'],
  },
  {
    id: 'comicverfilmung',
    name: 'Comicverfilmung',
    aliases: ['Comicverfilmung', 'Comicverfilmungen'],
  },
  {
    id: 'star-wars',
    name: 'Star Wars',
    aliases: ['Star Wars'],
  },
  { id: 'topic-zeitreisen', name: 'Zeitreisen', aliases: ['Zeitreise', 'Zeitreisen'] },
];

// Related concepts are deliberately not aliases (related does not mean identical).
export const TOPIC_RELATIONS = [
  { from: 'topic-comics', to: 'comicverfilmung', type: 'related' },
  { from: 'topic-darth-vader', to: 'star-wars', type: 'part_of' },
];

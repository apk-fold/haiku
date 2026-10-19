// Petits haïkus (écrits pour Haiku) affichés sur l'écran de verrouillage et l'accueil.
export const HAIKUS = [
  ['Sous la neige d\'encre', 'mille clés dorment au chaud —', 'le silence veille.'],
  ['Un mot murmuré', 'ouvre la porte du soir —', 'la lune s\'efface.'],
  ['Le vent cherche en vain', 'la serrure du jardin —', 'pétales tombés.'],
  ['Ce que je tais bien', 'dort dans le coffre de jade —', 'rien ne le réveille.'],
  ['Encre et papier blanc,', 'chaque lettre est un rempart —', 'l\'hiver ne passe pas.'],
  ['Le code s\'efface,', 'trente secondes de vie —', 'fleur de cerisier.'],
  ['Une clé de plus', 'glisse dans l\'étang sans fond —', 'aucune ride.'],
  ['Bambou sous la pluie,', 'mon secret plie sans casser —', 'l\'aube le retrouve.'],
  ['Lanterne éteinte,', 'les voleurs passent leur chemin —', 'le coffre sourit.'],
  ['Six mots au hasard', 'font un rempart de montagnes —', 'le pirate abdique.'],
];

export function haikuOfDay(offset = 0) {
  const d = new Date();
  const n = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  return HAIKUS[(n + offset) % HAIKUS.length];
}

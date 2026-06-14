const adjectives = [
  'Neon', 'Electric', 'Midnight', 'Cosmic', 'Golden', 'Cyber', 'Solar', 
  'Rusty', 'Sleepy', 'Fuzzy', 'Silver', 'Iron', 'Lunar', 'Silent', 
  'Aqua', 'Retro', 'Crimson', 'Shadow', 'Quantum', 'Velo', 'Aero'
];

const nouns = [
  'Wave', 'Rider', 'Fox', 'Wolf', 'Eagle', 'Tiger', 'Shark', 
  'Falcon', 'Knight', 'Rover', 'Beast', 'Storm', 'Lynx', 'Phoenix',
  'Panda', 'Cobra', 'Hawk', 'Viper', 'Ghost', 'Rogue', 'Hunter'
];

/**
 * Generates a random nickname with a 4-digit discriminator.
 * Example: 'ElectricRider#4983'
 */
export function generateNickname() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const disc = Math.floor(1000 + Math.random() * 9000); // 1000 to 9999
  return `${adj}${noun}#${disc}`;
}

export default generateNickname;

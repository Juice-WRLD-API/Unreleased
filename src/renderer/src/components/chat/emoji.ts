// Reactions travel as shortcode names ("fire"), so every client renders the
// same glyph for them. Anything not in this table is shown as sent.
export const EMOJI: Record<string, string> = {
  fire: '🔥', heart: '❤️', purple_heart: '💜', broken_heart: '💔', joy: '😂', rofl: '🤣', skull: '💀',
  sob: '😭', eyes: '👀', thumbsup: '👍', thumbsdown: '👎', pray: '🙏', clap: '👏', raised_hands: '🙌',
  muscle: '💪', ok_hand: '👌', wave: '👋', '100': '💯', tada: '🎉', sparkles: '✨', star: '⭐',
  rocket: '🚀', goat: '🐐', crown: '👑', gem: '💎', zap: '⚡', headphones: '🎧', musical_note: '🎵',
  microphone: '🎤', cd: '💿', thinking: '🤔', smile: '😄', grin: '😁', wink: '😉', heart_eyes: '😍',
  sunglasses: '😎', flushed: '😳', cry: '😢', rage: '😡', sweat_smile: '😅', shushing: '🤫', salute: '🫡',
  white_check_mark: '✅', x: '❌', warning: '⚠️', bangbang: '‼️', question: '❓', pushpin: '📌', lock: '🔒',

  // Expanded set (faces, gestures, hearts, animals, food, activities, travel, objects, symbols)
  relaxed: '☺️', blush: '😊', innocent: '😇', star_struck: '🤩', kissing_heart: '😘', yum: '😋',
  stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜', zany_face: '🤪', partying_face: '🥳',
  upside_down_face: '🙃', money_mouth_face: '🤑', nerd_face: '🤓', face_with_monocle: '🧐',
  smirk: '😏', unamused: '😒', roll_eyes: '🙄', grimacing: '😬', relieved: '😌', pensive: '😔',
  sleepy: '😪', drooling_face: '🤤', sleeping: '😴', mask: '😷', face_with_thermometer: '🤒',
  face_with_head_bandage: '🤕', nauseated_face: '🤢', vomiting_face: '🤮', sneezing_face: '🤧',
  hot_face: '🥵', cold_face: '🥶', woozy_face: '🥴', dizzy_face: '😵', exploding_head: '🤯',
  cowboy_hat_face: '🤠', clown_face: '🤡', smiling_imp: '😈', imp: '👿', japanese_ogre: '👹',
  japanese_goblin: '👺', ghost: '👻', alien: '👽', robot: '🤖', hushed: '😯', frowning: '😦',
  anguished: '😧', fearful: '😨', cold_sweat: '😰', scream: '😱', astonished: '😲', confused: '😕',
  worried: '😟', slightly_frowning_face: '🙁', persevere: '😣', confounded: '😖', tired_face: '😫',
  weary: '😩', triumph: '😤', angry: '😠', pouting_face: '😡', no_mouth: '😶', neutral_face: '😐',
  expressionless: '😑', zipper_mouth_face: '🤐', pleading_face: '🥺', hugging_face: '🤗',
  face_with_hand_over_mouth: '🤭', shushing_face: '🤫', face_with_raised_eyebrow: '🤨',
  yawning_face: '🥱', poop: '💩',

  victory_hand: '✌️', crossed_fingers: '🤞', love_you_gesture: '🤟', metal: '🤘', call_me_hand: '🤙',
  point_left: '👈', point_right: '👉', point_up_2: '👆', point_down: '👇', point_up: '☝️',
  middle_finger: '🖕', raised_hand: '✋', vulcan_salute: '🖖', writing_hand: '✍️', nail_care: '💅',
  selfie: '🤳', leg: '🦵', foot: '🦶', ear: '👂', nose: '👃', brain: '🧠', eye: '👁️', tongue: '👅',
  lips: '👄', tooth: '🦷', baby: '👶', boy: '👦', girl: '👧', man: '👨', woman: '👩',
  older_man: '👴', older_woman: '👵', detective: '🕵️',

  blue_heart: '💙', green_heart: '💚', yellow_heart: '💛', orange_heart: '🧡', black_heart: '🖤',
  white_heart: '🤍', brown_heart: '🤎', two_hearts: '💕', heartpulse: '💗', heartbeat: '💓',
  sparkling_heart: '💖', cupid: '💘', gift_heart: '💝', revolving_hearts: '💞',
  heart_decoration: '💟', kiss: '💋',

  dog: '🐶', cat: '🐱', mouse: '🐭', hamster: '🐹', rabbit: '🐰', fox_face: '🦊', bear: '🐻',
  panda_face: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁', cow: '🐮', pig: '🐷', frog: '🐸',
  monkey_face: '🐵', chicken: '🐔', penguin: '🐧', bird: '🐦', baby_chick: '🐤', eagle: '🦅',
  duck: '🦆', owl: '🦉', bat: '🦇', wolf: '🐺', horse: '🐴', unicorn: '🦄', bee: '🐝', bug: '🐛',
  butterfly: '🦋', snail: '🐌', snake: '🐍', turtle: '🐢', octopus: '🐙', fish: '🐟',
  dolphin: '🐬', whale: '🐳', shark: '🦈', elephant: '🐘', giraffe_face: '🦒', zebra_face: '🦓',
  dragon_face: '🐲', paw_prints: '🐾',

  apple: '🍎', pizza: '🍕', hamburger: '🍔', fries: '🍟', hotdog: '🌭', taco: '🌮', burrito: '🌯',
  popcorn: '🍿', doughnut: '🍩', cookie: '🍪', birthday: '🎂', cake: '🍰', icecream: '🍦',
  candy: '🍬', lollipop: '🍭', chocolate_bar: '🍫', grapes: '🍇', watermelon: '🍉',
  strawberry: '🍓', banana: '🍌', peach: '🍑', cherries: '🍒', lemon: '🍋', avocado: '🥑',
  carrot: '🥕', corn: '🌽', bread: '🍞', cheese: '🧀', egg: '🥚', bacon: '🥓', sushi: '🍣',
  ramen: '🍜', coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷', cocktail: '🍸',
  tropical_drink: '🍹', champagne: '🍾', baby_bottle: '🍼',

  soccer: '⚽', basketball: '🏀', football: '🏈', baseball: '⚾', tennis: '🎾', volleyball: '🏐',
  '8ball': '🎱', bowling: '🎳', golf: '⛳', boxing_glove: '🥊', trophy: '🏆', medal_sports: '🏅',
  first_place: '🥇', dart: '🎯', video_game: '🎮', game_die: '🎲', chess_pawn: '♟️',
  jigsaw: '🧩', guitar: '🎸', violin: '🎻', trumpet: '🎺', saxophone: '🎷', drum: '🥁',
  dancer: '💃', dancers: '👯',

  car: '🚗', taxi: '🚕', bus: '🚌', airplane: '✈️', helicopter: '🚁', train: '🚆', ship: '🚢',
  anchor: '⚓', bike: '🚲', motorcycle: '🏍️', world_map: '🗺️', mountain: '⛰️', camping: '🏕️',
  beach_umbrella: '🏖️', desert_island: '🏝️', stadium: '🏟️', moon: '🌙', sun_with_face: '🌞',
  full_moon: '🌕', earth_americas: '🌎', cloud: '☁️', sun_behind_cloud: '⛅',
  cloud_with_rain: '🌧️', snowflake: '❄️', snowman: '⛄', rainbow: '🌈', droplet: '💧',
  ocean_wave: '🌊', tornado: '🌪️', four_leaf_clover: '🍀', maple_leaf: '🍁', cactus: '🌵',
  palm_tree: '🌴', evergreen_tree: '🌲', rose: '🌹', tulip: '🌷', sunflower: '🌻',
  cherry_blossom: '🌸',

  tv: '📺', camera: '📷', iphone: '📱', computer: '💻', keyboard: '⌨️', battery: '🔋',
  electric_plug: '🔌', bulb: '💡', flashlight: '🔦', candle: '🕯️', money_with_wings: '💸',
  dollar: '💵', moneybag: '💰', credit_card: '💳', gift: '🎁', balloon: '🎈',
  confetti_ball: '🎊', ribbon: '🎀', bell: '🔔', mega: '📣', loudspeaker: '📢', bookmark: '🔖',
  book: '📖', newspaper: '📰', pencil2: '✏️', paperclip: '📎', scissors: '✂️', hammer: '🔨',
  wrench: '🔧', gear: '⚙️', link: '🔗', key: '🔑', hourglass: '⌛', alarm_clock: '⏰',
  calendar: '📅', umbrella: '☂️', sunglasses_obj: '🕶️', shirt: '👕', jeans: '👖', shoe: '👞',

  heavy_check_mark: '✔️', heavy_multiplication_x: '✖️', no_entry: '⛔', no_entry_sign: '🚫',
  exclamation: '❗', grey_exclamation: '❕', grey_question: '❔', heavy_plus_sign: '➕',
  heavy_minus_sign: '➖', infinity: '♾️', recycle: '♻️', radioactive: '☢️', peace: '☮️',
  yin_yang: '☯️', om: '🕉️', wheelchair: '♿', id: '🆔', new: '🆕', ok: '🆗', sos: '🆘', up: '🆙',
  cool: '🆒', free: '🆓', abc: '🔤', arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️',
  arrow_down: '⬇️', arrows_counterclockwise: '🔄', repeat: '🔁', shuffle: '🔀',
  fast_forward: '⏩', rewind: '⏪', play_pause: '⏯️', musical_notes: '🎶',
  speaker_high_volume: '🔊', mute: '🔇', vibration_mode: '📳', clock: '🕐',
}

export const QUICK_REACTIONS = ['fire', 'heart', 'joy', 'eyes', 'thumbsup', '100']

export const PICKER_GROUPS: { label: string; names: string[] }[] = [
  { label: 'Hype', names: ['fire', '100', 'goat', 'crown', 'gem', 'zap', 'rocket', 'tada', 'sparkles', 'star', 'clap', 'raised_hands', 'muscle', 'salute'] },
  { label: 'Faces', names: ['joy', 'rofl', 'skull', 'sob', 'smile', 'grin', 'wink', 'heart_eyes', 'sunglasses', 'thinking', 'flushed', 'cry', 'rage', 'sweat_smile', 'shushing', 'eyes'] },
  { label: 'Hearts & hands', names: ['heart', 'purple_heart', 'broken_heart', 'thumbsup', 'thumbsdown', 'pray', 'ok_hand', 'wave'] },
  { label: 'Music', names: ['headphones', 'musical_note', 'microphone', 'cd'] },
  { label: 'Signals', names: ['white_check_mark', 'x', 'warning', 'bangbang', 'question', 'pushpin', 'lock'] },
  { label: 'More faces', names: ['relaxed', 'blush', 'innocent', 'star_struck', 'kissing_heart', 'yum', 'stuck_out_tongue', 'stuck_out_tongue_winking_eye', 'zany_face', 'partying_face', 'upside_down_face', 'money_mouth_face', 'nerd_face', 'face_with_monocle', 'smirk', 'unamused', 'roll_eyes', 'grimacing', 'relieved', 'pensive', 'sleepy', 'drooling_face', 'sleeping', 'mask', 'face_with_thermometer', 'face_with_head_bandage', 'nauseated_face', 'vomiting_face', 'sneezing_face', 'hot_face', 'cold_face', 'woozy_face', 'dizzy_face', 'exploding_head', 'cowboy_hat_face', 'clown_face', 'smiling_imp', 'imp', 'japanese_ogre', 'japanese_goblin', 'ghost', 'alien', 'robot', 'hushed', 'frowning', 'anguished', 'fearful', 'cold_sweat', 'scream', 'astonished', 'confused', 'worried', 'slightly_frowning_face', 'persevere', 'confounded', 'tired_face', 'weary', 'triumph', 'angry', 'pouting_face', 'no_mouth', 'neutral_face', 'expressionless', 'zipper_mouth_face', 'pleading_face', 'hugging_face', 'face_with_hand_over_mouth', 'shushing_face', 'face_with_raised_eyebrow', 'yawning_face', 'poop'] },
  { label: 'Gestures & body', names: ['victory_hand', 'crossed_fingers', 'love_you_gesture', 'metal', 'call_me_hand', 'point_left', 'point_right', 'point_up_2', 'point_down', 'point_up', 'middle_finger', 'raised_hand', 'vulcan_salute', 'writing_hand', 'nail_care', 'selfie', 'leg', 'foot', 'ear', 'nose', 'brain', 'eye', 'tongue', 'lips', 'tooth', 'baby', 'boy', 'girl', 'man', 'woman', 'older_man', 'older_woman', 'detective'] },
  { label: 'More hearts', names: ['blue_heart', 'green_heart', 'yellow_heart', 'orange_heart', 'black_heart', 'white_heart', 'brown_heart', 'two_hearts', 'heartpulse', 'heartbeat', 'sparkling_heart', 'cupid', 'gift_heart', 'revolving_hearts', 'heart_decoration', 'kiss'] },
  { label: 'Animals', names: ['dog', 'cat', 'mouse', 'hamster', 'rabbit', 'fox_face', 'bear', 'panda_face', 'koala', 'tiger', 'lion', 'cow', 'pig', 'frog', 'monkey_face', 'chicken', 'penguin', 'bird', 'baby_chick', 'eagle', 'duck', 'owl', 'bat', 'wolf', 'horse', 'unicorn', 'bee', 'bug', 'butterfly', 'snail', 'snake', 'turtle', 'octopus', 'fish', 'dolphin', 'whale', 'shark', 'elephant', 'giraffe_face', 'zebra_face', 'dragon_face', 'paw_prints'] },
  { label: 'Food & drink', names: ['apple', 'pizza', 'hamburger', 'fries', 'hotdog', 'taco', 'burrito', 'popcorn', 'doughnut', 'cookie', 'birthday', 'cake', 'icecream', 'candy', 'lollipop', 'chocolate_bar', 'grapes', 'watermelon', 'strawberry', 'banana', 'peach', 'cherries', 'lemon', 'avocado', 'carrot', 'corn', 'bread', 'cheese', 'egg', 'bacon', 'sushi', 'ramen', 'coffee', 'tea', 'beer', 'beers', 'wine_glass', 'cocktail', 'tropical_drink', 'champagne', 'baby_bottle'] },
  { label: 'Activities & sports', names: ['soccer', 'basketball', 'football', 'baseball', 'tennis', 'volleyball', '8ball', 'bowling', 'golf', 'boxing_glove', 'trophy', 'medal_sports', 'first_place', 'dart', 'video_game', 'game_die', 'chess_pawn', 'jigsaw', 'guitar', 'violin', 'trumpet', 'saxophone', 'drum', 'dancer', 'dancers'] },
  { label: 'Travel & nature', names: ['car', 'taxi', 'bus', 'airplane', 'helicopter', 'train', 'ship', 'anchor', 'bike', 'motorcycle', 'world_map', 'mountain', 'camping', 'beach_umbrella', 'desert_island', 'stadium', 'moon', 'sun_with_face', 'full_moon', 'earth_americas', 'cloud', 'sun_behind_cloud', 'cloud_with_rain', 'snowflake', 'snowman', 'rainbow', 'droplet', 'ocean_wave', 'tornado', 'four_leaf_clover', 'maple_leaf', 'cactus', 'palm_tree', 'evergreen_tree', 'rose', 'tulip', 'sunflower', 'cherry_blossom'] },
  { label: 'Objects', names: ['tv', 'camera', 'iphone', 'computer', 'keyboard', 'battery', 'electric_plug', 'bulb', 'flashlight', 'candle', 'money_with_wings', 'dollar', 'moneybag', 'credit_card', 'gift', 'balloon', 'confetti_ball', 'ribbon', 'bell', 'mega', 'loudspeaker', 'bookmark', 'book', 'newspaper', 'pencil2', 'paperclip', 'scissors', 'hammer', 'wrench', 'gear', 'link', 'key', 'hourglass', 'alarm_clock', 'calendar', 'umbrella', 'sunglasses_obj', 'shirt', 'jeans', 'shoe'] },
  { label: 'More symbols', names: ['heavy_check_mark', 'heavy_multiplication_x', 'no_entry', 'no_entry_sign', 'exclamation', 'grey_exclamation', 'grey_question', 'heavy_plus_sign', 'heavy_minus_sign', 'infinity', 'recycle', 'radioactive', 'peace', 'yin_yang', 'om', 'wheelchair', 'id', 'new', 'ok', 'sos', 'up', 'cool', 'free', 'abc', 'arrow_right', 'arrow_left', 'arrow_up', 'arrow_down', 'arrows_counterclockwise', 'repeat', 'shuffle', 'fast_forward', 'rewind', 'play_pause', 'musical_notes', 'speaker_high_volume', 'mute', 'vibration_mode', 'clock'] },
]

export function emojiGlyph(name: string): string {
  return EMOJI[name] ?? name
}

// iOS-style PNGs for every glyph above, keyed by the same shortcode name.
const iosImages = import.meta.glob('../../assets/emoji/apple/*.png', { eager: true, import: 'default' }) as Record<string, string>
export const EMOJI_IMG: Record<string, string> = {}
for (const [path, url] of Object.entries(iosImages)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.png'.length)
  EMOJI_IMG[name] = url
}

// Reverse lookup so raw glyphs typed or pasted into message text can be
// swapped for their iOS image too, longest glyph first to prefer full
// sequences (e.g. the heart's variation selector) over bare prefixes.
export const NAME_BY_GLYPH: Record<string, string> = Object.fromEntries(
  Object.entries(EMOJI).map(([name, glyph]) => [glyph, name]),
)
export const GLYPHS_BY_LENGTH_DESC = Object.values(EMOJI).sort((a, b) => b.length - a.length)

const RECENT_KEY = 'unreleased:chat:recentEmoji'

export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    return Array.isArray(list) ? list.slice(0, 8) : []
  } catch {
    return []
  }
}

export function rememberEmoji(name: string): void {
  try {
    const next = [name, ...recentEmoji().filter((n) => n !== name)].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

// Most-recently-used reactions first, padded out with the defaults so the
// quick-react row always has `count` options even before a user reacts.
export function quickReactions(count = 3): string[] {
  const recent = recentEmoji()
  const merged = [...recent, ...QUICK_REACTIONS.filter((n) => !recent.includes(n))]
  return merged.slice(0, count)
}

export const organCatalog = {
  esophagus: {
    name: "Пищевод",
    photo: "./assets/photo-esophagus.webp",
    prompt: "Найди пищевод",
    location: "Пищевод — это трубка, которая проходит через грудную клетку к желудку.",
    function: "Когда ты глотаешь, мышцы в её стенках проталкивают пищу дальше.",
    thumbnailAngle: .7,
  },
  stomach: {
    name: "Желудок",
    photo: "./assets/lesson-study.webp",
    prompt: "Найди желудок",
    location: "Желудок находится вверху живота, ближе к левому боку.",
    function: "Он перемешивает еду с желудочным соком, и здесь начинается переваривание белков.",
  },
  liver: {
    name: "Печень",
    photo: "./assets/lesson-photo.webp",
    prompt: "Найди печень",
    location: "Большая часть печени находится справа под рёбрами.",
    function: "Она вырабатывает жёлчь, которая помогает переваривать жиры в тонкой кишке.",
  },
  pancreas: {
    name: "Поджелудочная железа",
    aliases: ["поджелудочная"],
    photo: "./assets/photo-pancreas.webp",
    prompt: "Найди поджелудочную железу",
    location: "Поджелудочная железа находится за желудком.",
    function: "Она вырабатывает пищеварительный сок, который поступает в тонкую кишку и помогает расщеплять пищу.",
  },
  "small-intestine": {
    name: "Тонкая кишка",
    aliases: ["тонкий кишечник"],
    photo: "./assets/photo-small-intestine.webp",
    prompt: "Найди тонкую кишку",
    location: "Тонкая кишка образует много петель в центре живота.",
    function: "Здесь пища переваривается дальше, а организм получает из неё большую часть питательных веществ.",
  },
  "large-intestine": {
    name: "Толстая кишка",
    aliases: ["толстый кишечник"],
    photo: "./assets/photo-large-intestine.webp",
    prompt: "Найди толстую кишку",
    location: "Толстая кишка огибает петли тонкой кишки сверху и по бокам.",
    function: "Она всасывает часть воды из остатков пищи, помогая сформировать кал.",
  },
};

export const organIds = Object.keys(organCatalog);

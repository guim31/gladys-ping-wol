// -----------------------------------------------------------------------------
// Texts sent from the container (action messages, connection status, errors),
// in the four languages of the Gladys interface. Entries are strings or
// functions of one parameter object. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown in the Configuration screen when the container cannot send ICMP
// (Docker older than 20.10, or a host that restricts ping sockets).
export const ICMP_DENIED = {
  en: 'Ping (ICMP) is not allowed in the container: hosts are checked over TCP only.',
  fr: "Le ping (ICMP) n'est pas autorisé dans le conteneur : les hôtes sont testés en TCP seulement.",
  de: 'Ping (ICMP) ist im Container nicht erlaubt: Hosts werden nur per TCP geprüft.',
  es: 'El ping (ICMP) no está permitido en el contenedor: los equipos se comprueban solo por TCP.',
};

// Validation errors of the "Add a host" action (keys: src/hosts.js).
export const ERRORS = {
  en: {
    name: 'Give the host a name.',
    nameLength: 'The name is too long (60 characters at most).',
    address: ({ value }) => `"${value}" is not an IPv4 address or a host name.`,
    mdns: ({ value }) =>
      `"${value}" is an mDNS name, which the integration cannot resolve: enter the IP address.`,
    mac: ({ value }) => `"${value}" is not a MAC address (e.g. 64:e4:d5:b4:12:66).`,
    broadcast: ({ value }) => `"${value}" is not an IPv4 broadcast address (e.g. 192.168.1.255).`,
    port: ({ value }) => `"${value}" is not a TCP port (1 to 65535).`,
    tcpPort: 'The TCP method needs a port.',
    tooMany: ({ max }) => `The list is full (${max} hosts).`,
  },
  fr: {
    name: "Donnez un nom à l'hôte.",
    nameLength: 'Le nom est trop long (60 caractères au plus).',
    address: ({ value }) => `« ${value} » n'est ni une adresse IPv4 ni un nom d'hôte.`,
    mdns: ({ value }) =>
      `« ${value} » est un nom mDNS, que l'intégration ne peut pas résoudre : saisissez l'adresse IP.`,
    mac: ({ value }) => `« ${value} » n'est pas une adresse MAC (ex. 64:e4:d5:b4:12:66).`,
    broadcast: ({ value }) =>
      `« ${value} » n'est pas une adresse de diffusion IPv4 (ex. 192.168.1.255).`,
    port: ({ value }) => `« ${value} » n'est pas un port TCP (1 à 65535).`,
    tcpPort: 'La méthode TCP demande un port.',
    tooMany: ({ max }) => `La liste est pleine (${max} hôtes).`,
  },
  de: {
    name: 'Gib dem Host einen Namen.',
    nameLength: 'Der Name ist zu lang (höchstens 60 Zeichen).',
    address: ({ value }) => `„${value}“ ist weder eine IPv4-Adresse noch ein Hostname.`,
    mdns: ({ value }) =>
      `„${value}“ ist ein mDNS-Name, den die Integration nicht auflösen kann: Gib die IP-Adresse ein.`,
    mac: ({ value }) => `„${value}“ ist keine MAC-Adresse (z. B. 64:e4:d5:b4:12:66).`,
    broadcast: ({ value }) => `„${value}“ ist keine IPv4-Broadcast-Adresse (z. B. 192.168.1.255).`,
    port: ({ value }) => `„${value}“ ist kein TCP-Port (1 bis 65535).`,
    tcpPort: 'Die TCP-Methode braucht einen Port.',
    tooMany: ({ max }) => `Die Liste ist voll (${max} Hosts).`,
  },
  es: {
    name: 'Dé un nombre al equipo.',
    nameLength: 'El nombre es demasiado largo (60 caracteres como máximo).',
    address: ({ value }) => `«${value}» no es una dirección IPv4 ni un nombre de equipo.`,
    mdns: ({ value }) =>
      `«${value}» es un nombre mDNS que la integración no puede resolver: introduzca la dirección IP.`,
    mac: ({ value }) => `«${value}» no es una dirección MAC (p. ej. 64:e4:d5:b4:12:66).`,
    broadcast: ({ value }) =>
      `«${value}» no es una dirección de difusión IPv4 (p. ej. 192.168.1.255).`,
    port: ({ value }) => `«${value}» no es un puerto TCP (de 1 a 65535).`,
    tcpPort: 'El método TCP necesita un puerto.',
    tooMany: ({ max }) => `La lista está llena (${max} equipos).`,
  },
};

// Reports of the Configuration screen actions.
export const REPORTS = {
  en: {
    added: ({ name }) => `${name} added.`,
    updated: ({ name }) => `${name} updated.`,
    answers: ({ latency, method }) => `It answers in ${latency} ms (${method}).`,
    silent: 'It does not answer right now.',
    discovery: 'Open the Discover tab to create its device.',
    removed: ({ name }) => `${name} removed from the list. Delete its device in Gladys if needed.`,
    notFound: ({ query }) => `No host is named "${query}" or has this address.`,
    found: ({ count, withMac }) =>
      `${count} new device(s) found on the network, ${withMac} with a MAC address:`,
    foundNone: 'No new device answered the network search (UPnP). Add your hosts by hand.',
    searchUnavailable: 'The network search is unavailable: add your hosts by hand.',
    toDiscovery: 'Open the Discover tab to add them.',
    hosts: ({ count }) => `${count} host(s) in the list.`,
  },
  fr: {
    added: ({ name }) => `${name} ajouté.`,
    updated: ({ name }) => `${name} mis à jour.`,
    answers: ({ latency, method }) => `Il répond en ${latency} ms (${method}).`,
    silent: 'Il ne répond pas pour le moment.',
    discovery: "Ouvrez l'onglet Découverte pour créer son appareil.",
    removed: ({ name }) =>
      `${name} retiré de la liste. Supprimez son appareil dans Gladys si besoin.`,
    notFound: ({ query }) => `Aucun hôte ne s'appelle « ${query} » ni n'a cette adresse.`,
    found: ({ count, withMac }) =>
      `${count} nouvel(s) appareil(s) trouvé(s) sur le réseau, dont ${withMac} avec adresse MAC :`,
    foundNone:
      "Aucun nouvel appareil n'a répondu à la recherche réseau (UPnP). Ajoutez vos hôtes à la main.",
    searchUnavailable: 'La recherche réseau est indisponible : ajoutez vos hôtes à la main.',
    toDiscovery: "Ouvrez l'onglet Découverte pour les ajouter.",
    hosts: ({ count }) => `${count} hôte(s) dans la liste.`,
  },
  de: {
    added: ({ name }) => `${name} hinzugefügt.`,
    updated: ({ name }) => `${name} aktualisiert.`,
    answers: ({ latency, method }) => `Er antwortet in ${latency} ms (${method}).`,
    silent: 'Er antwortet gerade nicht.',
    discovery: 'Öffne den Tab „Entdecken“, um sein Gerät anzulegen.',
    removed: ({ name }) =>
      `${name} aus der Liste entfernt. Lösche sein Gerät in Gladys, falls nötig.`,
    notFound: ({ query }) => `Kein Host heißt „${query}“ oder hat diese Adresse.`,
    found: ({ count, withMac }) =>
      `${count} neue(s) Gerät(e) im Netzwerk gefunden, davon ${withMac} mit MAC-Adresse:`,
    foundNone:
      'Kein neues Gerät hat auf die Netzwerksuche (UPnP) geantwortet. Füge deine Hosts von Hand hinzu.',
    searchUnavailable: 'Die Netzwerksuche ist nicht verfügbar: Füge deine Hosts von Hand hinzu.',
    toDiscovery: 'Öffne den Tab „Entdecken“, um sie hinzuzufügen.',
    hosts: ({ count }) => `${count} Host(s) in der Liste.`,
  },
  es: {
    added: ({ name }) => `${name} añadido.`,
    updated: ({ name }) => `${name} actualizado.`,
    answers: ({ latency, method }) => `Responde en ${latency} ms (${method}).`,
    silent: 'No responde en este momento.',
    discovery: 'Abra la pestaña Descubrir para crear su dispositivo.',
    removed: ({ name }) =>
      `${name} eliminado de la lista. Elimine su dispositivo en Gladys si lo necesita.`,
    notFound: ({ query }) => `Ningún equipo se llama «${query}» ni tiene esta dirección.`,
    found: ({ count, withMac }) =>
      `${count} dispositivo(s) nuevo(s) encontrado(s) en la red, ${withMac} con dirección MAC:`,
    foundNone:
      'Ningún dispositivo nuevo ha respondido a la búsqueda de red (UPnP). Añada sus equipos a mano.',
    searchUnavailable: 'La búsqueda de red no está disponible: añada sus equipos a mano.',
    toDiscovery: 'Abra la pestaña Descubrir para añadirlos.',
    hosts: ({ count }) => `${count} equipo(s) en la lista.`,
  },
};

// Errors of the wake command and of the scene actions, in the configured
// language (a scene action does not receive the user's language).
export const WAKE_ERRORS = {
  en: {
    unknown: 'This device is not a host of the Ping & Wake-on-LAN integration.',
    noMac: ({ name }) => `${name} has no MAC address: add the host again with its MAC address.`,
    address: ({ value }) => `"${value}" is not an IPv4 address or a host name.`,
  },
  fr: {
    unknown: "Cet appareil n'est pas un hôte de l'intégration Ping & Wake-on-LAN.",
    noMac: ({ name }) =>
      `${name} n'a pas d'adresse MAC : ajoutez à nouveau l'hôte avec son adresse MAC.`,
    address: ({ value }) => `« ${value} » n'est ni une adresse IPv4 ni un nom d'hôte.`,
  },
  de: {
    unknown: 'Dieses Gerät ist kein Host der Integration Ping & Wake-on-LAN.',
    noMac: ({ name }) =>
      `${name} hat keine MAC-Adresse: Füge den Host mit seiner MAC-Adresse erneut hinzu.`,
    address: ({ value }) => `„${value}“ ist weder eine IPv4-Adresse noch ein Hostname.`,
  },
  es: {
    unknown: 'Este dispositivo no es un equipo de la integración Ping & Wake-on-LAN.',
    noMac: ({ name }) =>
      `${name} no tiene dirección MAC: añada de nuevo el equipo con su dirección MAC.`,
    address: ({ value }) => `«${value}» no es una dirección IPv4 ni un nombre de equipo.`,
  },
};

/** A message table entry, rendered in every language. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    Object.entries(table).map(([language, entries]) => {
      const entry = entries[key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Join several rendered messages, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    Object.keys(messages[0]).map((language) => [
      language,
      messages.map((message) => message[language]).join(' '),
    ]),
  );
}

// Predictable annual shower dates and a release-time NASA/JPL close-approach snapshot.
// Shower source: International Meteor Organization 2026 Meteor Shower Calendar.
// Close-approach source: NASA/JPL SBDB Close Approach Data API v1.5, queried 2026-08-03.

globalThis.ASTRONOMY_EVENT_CATALOG = Object.freeze({
  generatedOn: '2026-08-03',
  meteorShowers: Object.freeze([
    { id: 'quadrantids', name: 'Quadrantids', start: [12, 28], peak: [1, 3], end: [1, 12], zhr: 80, hemisphere: 'Northern', radiant: 'Boötes' },
    { id: 'lyrids', name: 'Lyrids', start: [4, 14], peak: [4, 22], end: [4, 30], zhr: 18, hemisphere: 'Both', radiant: 'Lyra' },
    { id: 'eta-aquariids', name: 'Eta Aquariids', start: [4, 19], peak: [5, 5], end: [5, 28], zhr: 50, hemisphere: 'Southern favoured', radiant: 'Aquarius' },
    { id: 'delta-aquariids', name: 'Southern delta Aquariids', start: [7, 12], peak: [7, 30], end: [8, 23], zhr: 25, hemisphere: 'Southern favoured', radiant: 'Aquarius' },
    { id: 'perseids', name: 'Perseids', start: [7, 17], peak: [8, 12], end: [8, 24], zhr: 100, hemisphere: 'Northern favoured', radiant: 'Perseus' },
    { id: 'orionids', name: 'Orionids', start: [10, 2], peak: [10, 21], end: [11, 7], zhr: 20, hemisphere: 'Both', radiant: 'Orion' },
    { id: 'leonids', name: 'Leonids', start: [11, 6], peak: [11, 17], end: [11, 30], zhr: 15, hemisphere: 'Both', radiant: 'Leo' },
    { id: 'geminids', name: 'Geminids', start: [12, 4], peak: [12, 14], end: [12, 20], zhr: 150, hemisphere: 'Both', radiant: 'Gemini' },
    { id: 'ursids', name: 'Ursids', start: [12, 17], peak: [12, 22], end: [12, 26], zhr: 10, hemisphere: 'Northern', radiant: 'Ursa Minor' }
  ]),
  closeApproaches: Object.freeze([
    { id: '169p-neat-2026', kind: 'comet', name: '169P/NEAT', date: '2026-08-11T19:34:00Z', distanceAu: 0.167171527264355, relativeVelocityKms: 19.8968 },
    { id: '11p-tempel-swift-linear-2026', kind: 'comet', name: '11P/Tempel-Swift-LINEAR', date: '2026-11-11T19:13:00Z', distanceAu: 0.401205845479236, relativeVelocityKms: 7.8968 },
    { id: 'p-2020-g1-pimentel-2027', kind: 'comet', name: 'P/2020 G1 (Pimentel)', date: '2027-01-30T22:41:00Z', distanceAu: 0.466040100009892, relativeVelocityKms: 23.0633 }
  ])
});

const fr = {
  // App tagline
  tagline: "Comprenez votre santé, une visite à la fois",

  // Paywall
  paywall: {
    subscribe: "S'abonner — 4,99 $/mois",
    restore: "Restaurer les achats",
    disclaimer: "Annulez en tout temps. Facturé mensuellement via l'App Store ou Google Play.",
    features: [
      "Enregistrez vos rendez-vous médicaux",
      "Obtenez des résumés en langage clair grâce à l'IA",
      "Conservez l'historique complet de vos visites",
      "Ajoutez des suivis à votre calendrier",
    ],
  },

  // Auth screen
  auth: {
    fullName: "Nom complet",
    namePlaceholder: "Votre nom",
    email: "Courriel",
    password: "Mot de passe",
    ageConfirm: "Je confirme avoir 18 ans ou plus",
    signIn: "Se connecter",
    createAccount: "Créer un compte",
    signInWithApple: "Continuer avec Apple",
    signInWithGoogle: "Continuer avec Google",
    promoCode: "Code promotionnel (facultatif)",
  },

  // Recording consent
  recordingConsent: {
    title: "Avant d'enregistrer",
    providerAware: "Votre professionnel de santé est informé et a consenti à l'enregistrement de ce rendez-vous.",
    cancel: "Annuler",
    startRecording: "Commencer l'enregistrement",
  },

  // AI consent
  aiConsent: {
    title: "Avant d'analyser votre visite",
    intro: "Pour générer votre résumé, la transcription de votre visite sera envoyée de façon sécurisée à Anthropic Claude IA pour traitement.",
    whatSent: "Ce qui est envoyé :",
    whatSentDetail: "La transcription textuelle de votre visite uniquement.",
    whoReceives: "Qui le reçoit :",
    whoReceivesDetail: "Anthropic (anthropic.com) — un service d'IA tiers.",
    howUsed: "Comment c'est utilisé :",
    howUsedDetail: "Uniquement pour générer votre résumé. Les transcriptions ne sont pas conservées sur nos serveurs après le traitement.",
    disclaimer: "En appuyant sur « J'accepte », vous consentez à l'envoi de votre transcription à Anthropic pour traitement par IA. Veuillez vérifier l'exactitude de votre transcription et de votre résumé — la reconnaissance vocale peut mal interpréter les termes médicaux, les noms de médicaments ou les noms propres. Consultez notre politique de confidentialité à welluma.app/privacy.",
    decline: "Refuser",
    agree: "J'accepte",
  },

  // Share dialog
  share: {
    title: "Partager le résumé de visite",
    disclaimer: "⚠️ Avertissement : Vous partagez vos renseignements personnels sur la santé. Veuillez vérifier l'exactitude avant de partager — la reconnaissance vocale peut mal interpréter les termes médicaux. Ne partagez qu'avec des personnes de confiance comme des membres de la famille ou des aidants.",
    detail: "Ceci partagera un résumé textuel de votre visite incluant le résumé, les recommandations, les médicaments et les instructions de suivi.",
    cancel: "Annuler",
    share: "Partager le résumé",
    copied: "Résumé copié dans le presse-papiers !",
  },

  // Provider picker
  provider: {
    title: "Choisir un professionnel",
    namePlaceholder: "Dr. Jane Smith",
    specialty: "Spécialité",
    specialtyPlaceholder: "Cardiologie, Médecine familiale...",
    clinic: "Clinique / Hôpital",
    clinicPlaceholder: "Clinique Mayo, Hôpital général...",
    noSpecialty: "Aucune spécialité ajoutée",
    cancel: "Annuler",
    save: "Enregistrer le professionnel",
  },

  // Visit history
  history: {
    loading: "Chargement des visites...",
    noVisits: "Aucune visite pour l'instant. Enregistrez votre première visite pour la voir ici !",
    unknownProvider: "Professionnel inconnu",
    general: "Général",
    noFollowUp: "Aucune instruction de suivi trouvée pour cette visite.",
    addedToCalendar: "Ajouté à votre calendrier !",
    calendarError: "Impossible d'ouvrir le calendrier : ",
  },

  // Purchase alerts
  purchase: {
    noOfferings: "Aucune offre disponible. Veuillez réessayer.",
    noPackages: "Aucun forfait disponible.",
    failed: "Achat échoué : ",
    noSubscription: "Aucun abonnement actif trouvé.",
    restoreFailed: "Restauration échouée : ",
    tryAgain: "Veuillez réessayer.",
  },

  // Main app
  app: {
    visitSummaryTitle: "Résumé de visite Welluma",
    followUpCalendarTitle: "Suivi Welluma : ",
  },
};

export default fr;

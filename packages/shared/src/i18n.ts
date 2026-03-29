/**
 * Internationalization (i18n) string system.
 *
 * All user-facing text is keyed here for localization. To add a new language:
 * 1. Add the locale code to the SupportedLocale type
 * 2. Add translations to every string entry in STRINGS
 * 3. That's it — the notification service and UI pick it up automatically
 *
 * String keys use dot notation: "notification.delivery.enRoute"
 * Interpolation uses {{variable}} syntax: "Hi {{name}}, your delivery..."
 */

export type SupportedLocale = 'en' | 'es' | 'ar' | 'so' | 'fr' | 'zh';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  so: 'Soomaali',
  fr: 'Français',
  zh: '中文',
};

export const DEFAULT_LOCALE: SupportedLocale = 'en';

// ---------------------------------------------------------------------------
// String definitions — every user-facing string in the system
// ---------------------------------------------------------------------------

type StringEntry = Record<SupportedLocale, string>;

const STRINGS: Record<string, StringEntry> = {
  // --- Delivery notifications (sent to recipients via SMS/WhatsApp/Signal) ---
  'notification.delivery.enRoute': {
    en: 'Your delivery is on its way and should arrive soon.',
    es: 'Su entrega está en camino y debería llegar pronto.',
    ar: 'توصيلتك في الطريق وستصل قريباً.',
    so: 'Gaadiidkaagu waa soo socda waxayna dhowaan imanaysaa.',
    fr: 'Votre livraison est en route et devrait arriver bientôt.',
    zh: '您的配送正在路上，很快就会到达。',
  },
  'notification.delivery.delivered': {
    en: 'Your delivery has arrived.',
    es: 'Su entrega ha llegado.',
    ar: 'لقد وصلت توصيلتك.',
    so: 'Gaadiidkaagu wuu yimid.',
    fr: 'Votre livraison est arrivée.',
    zh: '您的配送已到达。',
  },
  'notification.delivery.ackPrompt': {
    en: 'Your delivery has arrived. Reply GOT IT to confirm.',
    es: 'Su entrega ha llegado. Responda RECIBIDO para confirmar.',
    ar: 'لقد وصلت توصيلتك. رد بكلمة تم للتأكيد.',
    so: 'Gaadiidkaagu wuu yimid. Ku jawaab HELAY si aad u xaqiijiso.',
    fr: 'Votre livraison est arrivée. Répondez RECU pour confirmer.',
    zh: '您的配送已到达。回复 收到 以确认。',
  },
  'notification.delivery.ackConfirmed': {
    en: 'Thank you! Your delivery is confirmed.',
    es: '¡Gracias! Su entrega está confirmada.',
    ar: 'شكراً! تم تأكيد توصيلتك.',
    so: 'Mahadsanid! Gaadiidkaaga waa la xaqiijiyay.',
    fr: 'Merci ! Votre livraison est confirmée.',
    zh: '谢谢！您的配送已确认。',
  },
  'notification.delivery.orphanedAlert': {
    en: 'Delivery not confirmed after {{minutes}} minutes. Please check on recipient.',
    es: 'Entrega no confirmada después de {{minutes}} minutos. Por favor verifique al destinatario.',
    ar: 'لم يتم تأكيد التوصيل بعد {{minutes}} دقيقة. يرجى التحقق من المستلم.',
    so: 'Gaadiidka lama xaqiijinin {{minutes}} daqiiqo kadib. Fadlan hubi qaabilaha.',
    fr: 'Livraison non confirmée après {{minutes}} minutes. Veuillez vérifier auprès du destinataire.',
    zh: '配送在{{minutes}}分钟后未确认。请检查收件人。',
  },
  'notification.delivery.failed': {
    en: 'We were unable to complete your delivery. We will try again soon.',
    es: 'No pudimos completar su entrega. Lo intentaremos de nuevo pronto.',
    ar: 'لم نتمكن من إكمال توصيلتك. سنحاول مرة أخرى قريباً.',
    so: 'Ma awoodnay inaan dhameystirno gaadiidkaaga. Dhowaan waan isku dayi doonaa mar kale.',
    fr: 'Nous n\'avons pas pu effectuer votre livraison. Nous réessaierons bientôt.',
    zh: '我们无法完成您的配送。我们将很快再次尝试。',
  },

  // --- Driver app UI strings ---
  'driver.status.idle': {
    en: 'Not checked in',
    es: 'No registrado',
    ar: 'لم يتم تسجيل الدخول',
    so: 'Lama diiwaangelinin',
    fr: 'Non enregistré',
    zh: '未签到',
  },
  'driver.status.checkedIn': {
    en: 'Checked in — waiting for dispatch',
    es: 'Registrado — esperando despacho',
    ar: 'تم تسجيل الدخول — في انتظار الإرسال',
    so: 'Waa la diiwaangeliyay — sugitaanka dirida',
    fr: 'Enregistré — en attente de dispatch',
    zh: '已签到 — 等待调度',
  },
  'driver.status.routesReleased': {
    en: 'Routes released — download your deliveries',
    es: 'Rutas liberadas — descargue sus entregas',
    ar: 'تم إصدار المسارات — قم بتنزيل توصيلاتك',
    so: 'Waddooyinka waa la sii daayay — soo deji gaadiidkaaga',
    fr: 'Routes publiées — téléchargez vos livraisons',
    zh: '路线已发布 — 下载您的配送任务',
  },
  'driver.action.checkIn': {
    en: 'Ready for Routes',
    es: 'Listo para Rutas',
    ar: 'جاهز للمسارات',
    so: 'U diyaar ah Waddooyinka',
    fr: 'Prêt pour les routes',
    zh: '准备接收路线',
  },
  'driver.action.endShift': {
    en: 'End Shift',
    es: 'Terminar Turno',
    ar: 'إنهاء الوردية',
    so: 'Dhamee Wareegga',
    fr: 'Fin de service',
    zh: '结束班次',
  },
  'driver.purge.confirmed': {
    en: 'Route data deleted. 0 addresses on this device.',
    es: 'Datos de ruta eliminados. 0 direcciones en este dispositivo.',
    ar: 'تم حذف بيانات المسار. 0 عناوين على هذا الجهاز.',
    so: 'Xogta waddada waa la tirtiray. 0 cinwaanno qalabkan ku jira.',
    fr: 'Données de route supprimées. 0 adresses sur cet appareil.',
    zh: '路线数据已删除。此设备上有0个地址。',
  },
  'driver.airplaneMode.approaching': {
    en: 'You\'re approaching the delivery area. Consider enabling airplane mode for privacy.',
    es: 'Se está acercando al área de entrega. Considere activar el modo avión para mayor privacidad.',
    ar: 'أنت تقترب من منطقة التوصيل. فكر في تفعيل وضع الطيران للخصوصية.',
    so: 'Waad ku soo dhowdahay aagga gaadiidka. Ka fakir shidida habka diyaaradda sirta awgeed.',
    fr: 'Vous approchez de la zone de livraison. Pensez à activer le mode avion pour la confidentialité.',
    zh: '您正在接近配送区域。请考虑开启飞行模式以保护隐私。',
  },
  'driver.airplaneMode.recommended': {
    en: 'Airplane mode recommended',
    es: 'Modo avión recomendado',
    ar: 'يُوصى بوضع الطيران',
    so: 'Habka diyaaradda waa la talinayaa',
    fr: 'Mode avion recommandé',
    zh: '建议开启飞行模式',
  },
  'driver.map.cachingTiles': {
    en: 'Caching maps for offline use...',
    es: 'Guardando mapas para uso sin conexión...',
    ar: 'تخزين الخرائط للاستخدام بدون اتصال...',
    so: 'Kaydinta khariidadaha isticmaalka offline...',
    fr: 'Mise en cache des cartes pour utilisation hors ligne...',
    zh: '正在缓存地图以供离线使用...',
  },
  'driver.map.cached': {
    en: 'Maps cached! You can navigate offline.',
    es: '¡Mapas guardados! Puede navegar sin conexión.',
    ar: 'تم تخزين الخرائط! يمكنك التنقل بدون اتصال.',
    so: 'Khariidadaha waa la kaydiyay! Waad ku socon kartaa offline.',
    fr: 'Cartes en cache ! Vous pouvez naviguer hors ligne.',
    zh: '地图已缓存！您可以离线导航。',
  },
  'driver.delivery.markDelivered': {
    en: 'Mark Delivered',
    es: 'Marcar Entregado',
    ar: 'تحديد كمُسلَّم',
    so: 'Calaamadee Gaarsiisan',
    fr: 'Marquer comme livré',
    zh: '标记为已送达',
  },
  'driver.delivery.markFailed': {
    en: 'Could Not Deliver',
    es: 'No Se Pudo Entregar',
    ar: 'تعذر التوصيل',
    so: 'Ma La Gaarsiin Karin',
    fr: 'Impossible de livrer',
    zh: '无法送达',
  },

  // --- Dashboard UI strings ---
  'dashboard.nav.home': {
    en: 'Dashboard',
    es: 'Panel',
    ar: 'لوحة التحكم',
    so: 'Dashboard-ka',
    fr: 'Tableau de bord',
    zh: '仪表板',
  },
  'dashboard.nav.recipients': {
    en: 'Recipients',
    es: 'Destinatarios',
    ar: 'المستلمون',
    so: 'Qaabilayaasha',
    fr: 'Destinataires',
    zh: '收件人',
  },
  'dashboard.nav.drivers': {
    en: 'Drivers',
    es: 'Conductores',
    ar: 'السائقون',
    so: 'Darawallada',
    fr: 'Chauffeurs',
    zh: '司机',
  },
  'dashboard.nav.dispatch': {
    en: 'Dispatch',
    es: 'Despacho',
    ar: 'الإرسال',
    so: 'Dirida',
    fr: 'Dispatch',
    zh: '调度',
  },
  'dashboard.nav.deliveries': {
    en: 'Deliveries',
    es: 'Entregas',
    ar: 'التوصيلات',
    so: 'Gaadiidyada',
    fr: 'Livraisons',
    zh: '配送',
  },
  'dashboard.nav.zones': {
    en: 'Zones',
    es: 'Zonas',
    ar: 'المناطق',
    so: 'Aagagga',
    fr: 'Zones',
    zh: '区域',
  },

  // --- Communication preferences ---
  'comm.sms': {
    en: 'SMS',
    es: 'SMS',
    ar: 'رسالة نصية',
    so: 'SMS',
    fr: 'SMS',
    zh: '短信',
  },
  'comm.whatsapp': {
    en: 'WhatsApp',
    es: 'WhatsApp',
    ar: 'واتساب',
    so: 'WhatsApp',
    fr: 'WhatsApp',
    zh: 'WhatsApp',
  },
  'comm.signal': {
    en: 'Signal',
    es: 'Signal',
    ar: 'سيغنال',
    so: 'Signal',
    fr: 'Signal',
    zh: 'Signal',
  },
};

// ---------------------------------------------------------------------------
// Lookup function
// ---------------------------------------------------------------------------

/**
 * Get a localized string by key.
 *
 * @param key - Dot-notation string key (e.g., "notification.delivery.enRoute")
 * @param locale - Target locale (defaults to 'en')
 * @param vars - Optional interpolation variables (e.g., { name: "John" })
 * @returns The localized string, or the English fallback, or the key itself
 */
export function t(
  key: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
  vars?: Record<string, string>,
): string {
  const entry = STRINGS[key];
  if (!entry) return key;

  let text = entry[locale] ?? entry[DEFAULT_LOCALE] ?? key;

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
  }

  return text;
}

/**
 * Get all string keys (useful for validation and testing).
 */
export function getAllStringKeys(): string[] {
  return Object.keys(STRINGS);
}

/**
 * Check if all keys have translations for a given locale.
 * Returns keys that are missing translations.
 */
export function getMissingTranslations(locale: SupportedLocale): string[] {
  return Object.entries(STRINGS)
    .filter(([, entry]) => !entry[locale])
    .map(([key]) => key);
}

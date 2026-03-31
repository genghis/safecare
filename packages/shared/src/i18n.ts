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

  // --- Login screen ---
  'driver.login.appName': { en: 'SafeCare', es: 'SafeCare', ar: 'SafeCare', so: 'SafeCare', fr: 'SafeCare', zh: 'SafeCare' },
  'driver.login.subtitle': { en: 'Driver Delivery App', es: 'Aplicación de Entregas para Conductores', ar: 'تطبيق توصيل السائق', so: 'Barnaamijka Gaadiidka Darawalka', fr: 'Application de livraison chauffeur', zh: '司机配送应用' },
  'driver.login.phoneLabel': { en: 'Phone Number', es: 'Número de Teléfono', ar: 'رقم الهاتف', so: 'Lambarka Telefoonka', fr: 'Numéro de téléphone', zh: '电话号码' },
  'driver.login.sendCode': { en: 'Send Verification Code', es: 'Enviar Código de Verificación', ar: 'إرسال رمز التحقق', so: 'Dir Koodhka Xaqiijinta', fr: 'Envoyer le code de vérification', zh: '发送验证码' },
  'driver.login.otpLabel': { en: 'Enter Verification Code', es: 'Ingrese el Código de Verificación', ar: 'أدخل رمز التحقق', so: 'Geli Koodhka Xaqiijinta', fr: 'Entrez le code de vérification', zh: '输入验证码' },
  'driver.login.otpHint': { en: 'A 6-digit code was sent to {{phone}}', es: 'Se envió un código de 6 dígitos a {{phone}}', ar: 'تم إرسال رمز مكون من 6 أرقام إلى {{phone}}', so: 'Koodh 6 lambar ah ayaa loo diray {{phone}}', fr: 'Un code à 6 chiffres a été envoyé au {{phone}}', zh: '已向 {{phone}} 发送6位验证码' },
  'driver.login.verify': { en: 'Verify & Sign In', es: 'Verificar e Iniciar Sesión', ar: 'تحقق وسجل الدخول', so: 'Xaqiiji oo Gal', fr: 'Vérifier et se connecter', zh: '验证并登录' },
  'driver.login.back': { en: 'Back', es: 'Volver', ar: 'رجوع', so: 'Dib u noqo', fr: 'Retour', zh: '返回' },
  'driver.login.errorPhone': { en: 'Enter a valid phone number.', es: 'Ingrese un número de teléfono válido.', ar: 'أدخل رقم هاتف صالح.', so: 'Geli lambar telefoon sax ah.', fr: 'Entrez un numéro de téléphone valide.', zh: '请输入有效的电话号码。' },
  'driver.login.errorOtp': { en: 'Enter the 6-digit code.', es: 'Ingrese el código de 6 dígitos.', ar: 'أدخل الرمز المكون من 6 أرقام.', so: 'Geli koodhka 6 lambar.', fr: 'Entrez le code à 6 chiffres.', zh: '请输入6位验证码。' },
  'driver.login.errorOtpRequest': { en: 'Could not request OTP. Is this phone number registered as a driver?', es: '¿No se pudo solicitar el código. ¿Este número de teléfono está registrado como conductor?', ar: 'تعذر طلب رمز التحقق. هل هذا الرقم مسجل كسائق؟', so: 'Ma la codsan karin koodhka. Lambarkani ma u diiwaangashan yahay darawal?', fr: 'Impossible de demander le code. Ce numéro est-il enregistré en tant que chauffeur ?', zh: '无法请求验证码。此电话号码是否已注册为司机？' },
  'driver.login.errorOtpInvalid': { en: 'Invalid or expired code. Please try again.', es: 'Código inválido o expirado. Por favor intente de nuevo.', ar: 'رمز غير صالح أو منتهي الصلاحية. يرجى المحاولة مرة أخرى.', so: 'Koodh aan sax ahayn ama uu dhacay. Fadlan isku day mar kale.', fr: 'Code invalide ou expiré. Veuillez réessayer.', zh: '验证码无效或已过期。请重试。' },
  'driver.login.devOtp': { en: 'Dev mode — your code is:', es: 'Modo desarrollo — su código es:', ar: 'وضع التطوير — رمزك هو:', so: 'Habka horumarinta — koodhkaagu waa:', fr: 'Mode développement — votre code est :', zh: '开发模式 — 您的验证码是：' },

  // --- Dashboard screen ---
  'driver.dashboard.myProfile': { en: 'My Profile', es: 'Mi Perfil', ar: 'ملفي الشخصي', so: 'Bogaygga', fr: 'Mon profil', zh: '我的资料' },
  'driver.dashboard.readyPrompt': { en: 'Ready to start your shift?', es: '¿Listo para comenzar su turno?', ar: 'هل أنت جاهز لبدء ورديتك؟', so: 'Ma u diyaar tahay inaad bilowdo wareegaaga?', fr: 'Prêt à commencer votre service ?', zh: '准备好开始您的班次了吗？' },
  'driver.dashboard.waitingForRoutes': { en: 'Waiting for routes to be released...', es: 'Esperando que se liberen las rutas...', ar: 'في انتظار إصدار المسارات...', so: 'La sugayo in waddooyinka la sii daayo...', fr: 'En attente de la publication des routes...', zh: '等待路线发布...' },
  'driver.dashboard.checkForRoutes': { en: 'Check for Routes', es: 'Buscar Rutas', ar: 'التحقق من المسارات', so: 'Hubi Waddooyinka', fr: 'Vérifier les routes', zh: '检查路线' },
  'driver.dashboard.remaining': { en: 'Remaining', es: 'Restantes', ar: 'متبقية', so: 'Haray', fr: 'Restantes', zh: '剩余' },
  'driver.dashboard.delivered': { en: 'Delivered', es: 'Entregadas', ar: 'تم التوصيل', so: 'La gaarsiiyay', fr: 'Livrées', zh: '已送达' },
  'driver.dashboard.total': { en: 'Total', es: 'Total', ar: 'الإجمالي', so: 'Wadarta', fr: 'Total', zh: '总计' },
  'driver.dashboard.refresh': { en: 'Refresh', es: 'Actualizar', ar: 'تحديث', so: 'Cusboonaysii', fr: 'Actualiser', zh: '刷新' },
  'driver.dashboard.refreshing': { en: 'Refreshing...', es: 'Actualizando...', ar: 'جارٍ التحديث...', so: 'Waa la cusboonaysiinayaa...', fr: 'Actualisation...', zh: '正在刷新...' },
  'driver.dashboard.availableOffline': { en: 'Available offline', es: 'Disponible sin conexión', ar: 'متاح بدون اتصال', so: 'Waa la heli karaa offline', fr: 'Disponible hors ligne', zh: '可离线使用' },
  'driver.dashboard.errorCheckIn': { en: 'Could not check in. Please try again.', es: 'No se pudo registrar. Por favor intente de nuevo.', ar: 'تعذر تسجيل الدخول. يرجى المحاولة مرة أخرى.', so: 'Ma la diiwaangelin karin. Fadlan isku day mar kale.', fr: "Impossible de s'enregistrer. Veuillez réessayer.", zh: '无法签到。请重试。' },
  'driver.dashboard.errorRoutesNotReleased': { en: 'Routes have not been released yet. Try again shortly.', es: 'Las rutas aún no se han liberado. Intente de nuevo en breve.', ar: 'لم يتم إصدار المسارات بعد. حاول مرة أخرى قريباً.', so: 'Waddooyinka wali lama sii dayin. Isku day mar kale dhowaan.', fr: "Les routes n'ont pas encore été publiées. Réessayez sous peu.", zh: '路线尚未发布。请稍后再试。' },
  'driver.dashboard.errorFetchRoutes': { en: 'Could not fetch routes. Check your connection.', es: 'No se pudieron obtener las rutas. Verifique su conexión.', ar: 'تعذر جلب المسارات. تحقق من اتصالك.', so: 'Ma la soo qaadan karin waddooyinka. Hubi xiriirkaaga.', fr: 'Impossible de récupérer les routes. Vérifiez votre connexion.', zh: '无法获取路线。请检查您的网络连接。' },
  'driver.dashboard.errorEndShift': { en: 'Could not end shift. Try again when online.', es: 'No se pudo terminar el turno. Intente cuando esté en línea.', ar: 'تعذر إنهاء الوردية. حاول مرة أخرى عندما تكون متصلاً.', so: 'Ma la dhammayn karin wareegga. Isku day markii aad ku xiran tahay.', fr: 'Impossible de terminer le service. Réessayez en ligne.', zh: '无法结束班次。请在联网时重试。' },
  'driver.dashboard.endShiftTitle': { en: 'End Shift', es: 'Terminar Turno', ar: 'إنهاء الوردية', so: 'Dhamee Wareegga', fr: 'Fin de service', zh: '结束班次' },
  'driver.dashboard.endShiftMessage': { en: 'This will sync remaining updates and clear all local data. This action cannot be undone.', es: 'Esto sincronizará las actualizaciones restantes y borrará todos los datos locales. Esta acción no se puede deshacer.', ar: 'سيؤدي هذا إلى مزامنة التحديثات المتبقية ومسح جميع البيانات المحلية. لا يمكن التراجع عن هذا الإجراء.', so: 'Tani waxay isku dubbaridi doontaa cusboonaysiinta haray waxayna tirtiri doontaa dhammaan xogta maxalliga. Tallaabadan dib looma noqon karo.', fr: 'Cela synchronisera les mises à jour restantes et effacera toutes les données locales. Cette action est irréversible.', zh: '这将同步剩余更新并清除所有本地数据。此操作无法撤销。' },

  // --- DeliveryDetail screen ---
  'driver.delivery.notFound': { en: 'Delivery not found.', es: 'Entrega no encontrada.', ar: 'لم يتم العثور على التوصيل.', so: 'Gaadiidka lama helin.', fr: 'Livraison introuvable.', zh: '未找到配送。' },
  'driver.delivery.goBack': { en: 'Go Back', es: 'Volver', ar: 'رجوع', so: 'Dib u noqo', fr: 'Retour', zh: '返回' },
  'driver.delivery.airplaneWarning': { en: 'Turn on Airplane Mode when approaching the delivery address to minimize location tracking.', es: 'Active el Modo Avión al acercarse a la dirección de entrega para minimizar el rastreo de ubicación.', ar: 'قم بتشغيل وضع الطيران عند الاقتراب من عنوان التوصيل لتقليل تتبع الموقع.', so: 'Shid Habka Diyaaradda markaad u soo dhowdahay cinwaanka gaadiidka si loo yareeyo la socodka goobta.', fr: "Activez le mode avion en approchant de l'adresse de livraison pour limiter le suivi de localisation.", zh: '接近配送地址时请开启飞行模式以减少位置追踪。' },
  'driver.delivery.backToDashboard': { en: 'Back to Dashboard', es: 'Volver al Panel', ar: 'العودة إلى لوحة التحكم', so: 'Ku noqo Dashboard-ka', fr: 'Retour au tableau de bord', zh: '返回仪表板' },
  'driver.delivery.addressLabel': { en: 'Address', es: 'Dirección', ar: 'العنوان', so: 'Cinwaanka', fr: 'Adresse', zh: '地址' },
  'driver.delivery.notesLabel': { en: 'Notes', es: 'Notas', ar: 'ملاحظات', so: 'Qoraallo', fr: 'Notes', zh: '备注' },
  'driver.delivery.statusLabel': { en: 'Status', es: 'Estado', ar: 'الحالة', so: 'Xaalada', fr: 'Statut', zh: '状态' },
  'driver.delivery.statusDelivered': { en: 'Delivered', es: 'Entregado', ar: 'تم التوصيل', so: 'La gaarsiiyay', fr: 'Livré', zh: '已送达' },
  'driver.delivery.statusInTransit': { en: 'In Transit', es: 'En Tránsito', ar: 'قيد التوصيل', so: 'Waa la qaadayaa', fr: 'En transit', zh: '运输中' },
  'driver.delivery.statusPending': { en: 'Pending', es: 'Pendiente', ar: 'قيد الانتظار', so: 'La sugayo', fr: 'En attente', zh: '待处理' },
  'driver.delivery.headingToRoute': { en: 'Heading to Route', es: 'Rumbo a la Ruta', ar: 'متوجه إلى المسار', so: 'U socda Waddada', fr: 'En route vers la livraison', zh: '前往路线' },
  'driver.delivery.completed': { en: 'Delivery completed', es: 'Entrega completada', ar: 'اكتملت التوصيلة', so: 'Gaadiidku wuu dhammaadey', fr: 'Livraison effectuée', zh: '配送已完成' },

  // --- RestoreKey screen ---
  'driver.restore.title': { en: 'Restore Routes', es: 'Restaurar Rutas', ar: 'استعادة المسارات', so: 'Soo Celi Waddooyinka', fr: 'Restaurer les routes', zh: '恢复路线' },
  'driver.restore.description': { en: 'Your routes are encrypted on this device. Scan your backup QR code to unlock them.', es: 'Sus rutas están cifradas en este dispositivo. Escanee su código QR de respaldo para desbloquearlas.', ar: 'مساراتك مشفرة على هذا الجهاز. امسح رمز QR الاحتياطي لفتحها.', so: 'Waddooyinkaagu waxay ku xidhan yihiin qalabkan. Sawir koodhka QR-ka kaydka si aad u furtid.', fr: 'Vos routes sont chiffrées sur cet appareil. Scannez votre code QR de sauvegarde pour les déverrouiller.', zh: '您的路线已在此设备上加密。扫描您的备份二维码以解锁。' },
  'driver.restore.scanQr': { en: 'Scan QR Code', es: 'Escanear Código QR', ar: 'مسح رمز QR', so: 'Sawir Koodhka QR', fr: 'Scanner le code QR', zh: '扫描二维码' },
  'driver.restore.skipFresh': { en: 'Skip & Start Fresh', es: 'Omitir y Empezar de Nuevo', ar: 'تخطي والبدء من جديد', so: 'Ka bood oo Dib u bilow', fr: 'Ignorer et recommencer', zh: '跳过并重新开始' },
  'driver.restore.skipWarning': { en: '"Start Fresh" will erase all cached routes and return to login.', es: '"Empezar de Nuevo" borrará todas las rutas guardadas y volverá al inicio de sesión.', ar: '"البدء من جديد" سيمسح جميع المسارات المخزنة ويعود إلى تسجيل الدخول.', so: '"Dib u bilow" waxay tirtiri doontaa dhammaan waddooyinka la kaydiyay waxayna ku celin doontaa gelitaanka.', fr: '"Recommencer" effacera toutes les routes en cache et reviendra à la connexion.', zh: '"重新开始"将删除所有缓存路线并返回登录页面。' },
  'driver.restore.errorInvalidQr': { en: 'Invalid QR code. Please scan the SafeCare backup key.', es: 'Código QR inválido. Por favor escanee la clave de respaldo de SafeCare.', ar: 'رمز QR غير صالح. يرجى مسح مفتاح النسخ الاحتياطي لـ SafeCare.', so: 'Koodhka QR-ka ma sax aha. Fadlan sawir furaha kaydka SafeCare.', fr: 'Code QR invalide. Veuillez scanner la clé de sauvegarde SafeCare.', zh: '无效的二维码。请扫描SafeCare备份密钥。' },
  'driver.restore.errorInvalidKey': { en: 'Invalid key format in QR code.', es: 'Formato de clave inválido en el código QR.', ar: 'تنسيق مفتاح غير صالح في رمز QR.', so: 'Qaabka furaha ee koodhka QR-ka ma sax aha.', fr: 'Format de clé invalide dans le code QR.', zh: '二维码中的密钥格式无效。' },
  'driver.restore.errorRestore': { en: 'Failed to restore encryption key. Try again.', es: 'Error al restaurar la clave de cifrado. Intente de nuevo.', ar: 'فشل في استعادة مفتاح التشفير. حاول مرة أخرى.', so: 'Waa lagu guul daraystay soo celinta furaha sirta. Isku day mar kale.', fr: 'Échec de la restauration de la clé de chiffrement. Réessayez.', zh: '恢复加密密钥失败。请重试。' },
  'driver.restore.errorCamera': { en: 'Could not access camera. Please allow camera permission and try again.', es: 'No se pudo acceder a la cámara. Permita el acceso a la cámara e intente de nuevo.', ar: 'تعذر الوصول إلى الكاميرا. يرجى السماح بإذن الكاميرا والمحاولة مرة أخرى.', so: 'Ma la geli karin kaamiradda. Fadlan ogolow oggolaanshaha kaamiradda oo isku day mar kale.', fr: "Impossible d'accéder à la caméra. Veuillez autoriser l'accès et réessayer.", zh: '无法访问摄像头。请允许摄像头权限后重试。' },

  // --- BackupKeyOverlay ---
  'driver.backup.title': { en: 'Save Backup Key', es: 'Guardar Clave de Respaldo', ar: 'حفظ مفتاح النسخ الاحتياطي', so: 'Kaydi Furaha Kaydka', fr: 'Enregistrer la clé de sauvegarde', zh: '保存备份密钥' },
  'driver.backup.description': { en: "Take a photo of this code. If the app closes while you're offline, scan it to restore your routes.", es: 'Tome una foto de este código. Si la aplicación se cierra mientras está sin conexión, escanéelo para restaurar sus rutas.', ar: 'التقط صورة لهذا الرمز. إذا أُغلق التطبيق أثناء عدم الاتصال، امسحه لاستعادة مساراتك.', so: 'Ka sawir koodhkan. Haddii barnaamijka uu xirmo adoo offline ah, sawir si aad u soo celiso waddooyinkaaga.', fr: "Prenez une photo de ce code. Si l'application se ferme hors ligne, scannez-le pour restaurer vos routes.", zh: '拍下此二维码的照片。如果应用在离线时关闭，扫描它即可恢复您的路线。' },
  'driver.backup.dismiss': { en: "I've Saved It", es: 'Ya lo Guardé', ar: 'لقد حفظته', so: 'Waan Kaydiyay', fr: "C'est enregistré", zh: '我已保存' },

  // --- PanicButton ---
  'driver.panic.erase': { en: 'Erase', es: 'Borrar', ar: 'مسح', so: 'Tirtir', fr: 'Effacer', zh: '清除' },
  'driver.panic.erasing': { en: 'Erasing...', es: 'Borrando...', ar: 'جارٍ المسح...', so: 'Waa la tirtirayaa...', fr: 'Suppression...', zh: '正在清除...' },
  'driver.panic.ariaLabel': { en: 'Emergency erase — hold to activate', es: 'Borrado de emergencia — mantenga presionado para activar', ar: 'مسح طوارئ — اضغط مع الاستمرار للتفعيل', so: 'Tirtir degdeg — hay si aad u hawlgeliso', fr: "Effacement d'urgence — maintenez pour activer", zh: '紧急清除 — 长按以激活' },

  // --- ConfirmDialog ---
  'driver.confirm.confirm': { en: 'Confirm', es: 'Confirmar', ar: 'تأكيد', so: 'Xaqiiji', fr: 'Confirmer', zh: '确认' },
  'driver.confirm.cancel': { en: 'Cancel', es: 'Cancelar', ar: 'إلغاء', so: 'Ka noqo', fr: 'Annuler', zh: '取消' },

  // --- StatusBar ---
  'driver.statusBar.checkedIn': { en: 'Checked in — waiting for routes', es: 'Registrado — esperando rutas', ar: 'تم تسجيل الدخول — في انتظار المسارات', so: 'Waa la diiwaangeliyay — sugitaanka waddooyinka', fr: 'Enregistré — en attente des routes', zh: '已签到 — 等待路线' },
  'driver.statusBar.routesActive': { en: 'Routes active', es: 'Rutas activas', ar: 'المسارات نشطة', so: 'Waddooyinku way shaqaynayaan', fr: 'Routes actives', zh: '路线已激活' },
  'driver.statusBar.shiftEnded': { en: 'Shift ended', es: 'Turno terminado', ar: 'انتهت الوردية', so: 'Wareegga waa dhammaadey', fr: 'Service terminé', zh: '班次已结束' },
  'driver.statusBar.online': { en: 'Online', es: 'En línea', ar: 'متصل', so: 'Ku xiran', fr: 'En ligne', zh: '在线' },
  'driver.statusBar.offline': { en: 'Offline', es: 'Sin conexión', ar: 'غير متصل', so: 'Ka baxsan', fr: 'Hors ligne', zh: '离线' },
  'driver.statusBar.offlineMessage': { en: 'You are offline — updates will sync when reconnected', es: 'Está sin conexión — las actualizaciones se sincronizarán al reconectarse', ar: 'أنت غير متصل — ستتم مزامنة التحديثات عند إعادة الاتصال', so: 'Waad ka baxsan tahay — cusboonaysiintu waxay isku dubbaridaan markaad dib u xiran tahay', fr: 'Vous êtes hors ligne — les mises à jour seront synchronisées à la reconnexion', zh: '您已离线 — 重新连接后将同步更新' },
  'driver.statusBar.pending': { en: '{{count}} pending', es: '{{count}} pendientes', ar: '{{count}} قيد الانتظار', so: '{{count}} la sugayo', fr: '{{count}} en attente', zh: '{{count}} 待处理' },

  // --- AirplaneModeReminder (stop-level alert) ---
  'driver.airplaneMode.stopAlert': { en: 'Approaching delivery address — enable airplane mode now!', es: 'Acercándose a la dirección de entrega — ¡active el modo avión ahora!', ar: 'تقترب من عنوان التوصيل — قم بتفعيل وضع الطيران الآن!', so: 'Waad u soo dhowdahay cinwaanka gaadiidka — shid habka diyaaradda hadda!', fr: "Approche de l'adresse de livraison — activez le mode avion maintenant !", zh: '正在接近配送地址 — 请立即开启飞行模式！' },
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

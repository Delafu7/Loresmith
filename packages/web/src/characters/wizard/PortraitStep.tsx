// Wraps the existing ImageUploadField verbatim — requires a real
// characterId (services/assets.ts links portrait_asset_id as a side effect
// of the upload itself when characterId is supplied), which is why this is
// the LAST step: by the time it's reachable, createdCharacterId is always
// set (see CharacterCreationWizard.tsx's submitCharacter).
import type { CampaignAsset } from '../../lib/types';
import { ImageUploadField } from '../../components/ImageUploadField';
import { Portrait } from '../../components/Portrait';
import { useLocale } from '../../i18n/LocaleContext';

export function PortraitStep({
  campaignId,
  characterId,
  portraitFileUrl,
  onUploaded,
}: {
  campaignId: string;
  characterId: string;
  portraitFileUrl: string | null;
  onUploaded: (asset: CampaignAsset) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-4">
      <Portrait fileUrl={portraitFileUrl} alt={t('characters.wizard.portrait.alt')} size="lg" />
      <ImageUploadField campaignId={campaignId} characterId={characterId} onUploaded={onUploaded} label={t('characters.wizard.portrait.upload')} />
    </div>
  );
}

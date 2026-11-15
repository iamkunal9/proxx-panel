import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { parsePriceInput, priceOverrideKey } from '@/services/api/proxxPricing';
import type { PriceOverride } from '@/types/proxx';
import styles from '../PricingPage.module.scss';

type PriceField = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning';

const PRICE_FIELDS: PriceField[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

interface PriceEditorModalProps {
  open: boolean;
  /** Existing override being edited, or a prefilled draft for a new one. */
  initial: PriceOverride | null;
  isNew: boolean;
  others: PriceOverride[];
  modelOptions: string[];
  providerOptions: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (entry: PriceOverride) => void;
}

const toText = (value: number | null) => (value === null ? '' : String(value));

export function PriceEditorModal({
  open,
  initial,
  isNew,
  others,
  modelOptions,
  providerOptions,
  saving,
  onClose,
  onSave,
}: PriceEditorModalProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [prices, setPrices] = useState<Record<PriceField, string>>({
    input: '',
    output: '',
    cacheRead: '',
    cacheWrite: '',
    reasoning: '',
  });
  const [override, setOverride] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setModel(initial?.model ?? '');
    setProvider(initial?.provider ?? '');
    setPrices({
      input: toText(initial?.input ?? null),
      output: toText(initial?.output ?? null),
      cacheRead: toText(initial?.cacheRead ?? null),
      cacheWrite: toText(initial?.cacheWrite ?? null),
      reasoning: toText(initial?.reasoning ?? null),
    });
    setOverride(initial?.override ?? false);
    setSubmitted(false);
  }, [open, initial]);

  const parsed = Object.fromEntries(
    PRICE_FIELDS.map((field) => [field, parsePriceInput(prices[field])])
  ) as Record<PriceField, number | null | undefined>;
  const modelError = !model.trim() ? t('proxx.pricing.error.model_required') : '';
  const duplicate = others.some(
    (entry) => priceOverrideKey(entry) === priceOverrideKey({ model, provider })
  );
  const hasInvalidPrice = PRICE_FIELDS.some((field) => parsed[field] === undefined);
  const hasAnyPrice = PRICE_FIELDS.some(
    (field) => parsed[field] !== null && parsed[field] !== undefined
  );

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setSubmitted(true);
    if (modelError || duplicate || hasInvalidPrice || !hasAnyPrice) return;
    onSave({
      model: model.trim(),
      provider: provider.trim(),
      input: parsed.input ?? null,
      output: parsed.output ?? null,
      cacheRead: parsed.cacheRead ?? null,
      cacheWrite: parsed.cacheWrite ?? null,
      reasoning: parsed.reasoning ?? null,
      override,
    });
  };

  const formError = !submitted
    ? ''
    : duplicate
      ? t('proxx.pricing.error.duplicate')
      : hasInvalidPrice
        ? t('proxx.pricing.error.invalid_price')
        : !hasAnyPrice
          ? t('proxx.pricing.error.price_required')
          : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      width={600}
      title={isNew ? t('proxx.pricing.add_title') : t('proxx.pricing.edit_title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {t('proxx.common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.editor} onSubmit={handleSubmit}>
        <div className={styles.editorGrid2}>
          <AutocompleteInput
            label={t('proxx.pricing.col.model')}
            value={model}
            onChange={setModel}
            options={modelOptions}
            placeholder="gpt-5-mini"
            hint={t('proxx.pricing.field_model_hint')}
            error={submitted && modelError ? modelError : undefined}
          />
          <AutocompleteInput
            label={t('proxx.pricing.col.provider')}
            value={provider}
            onChange={setProvider}
            options={providerOptions}
            placeholder={t('proxx.pricing.any_provider')}
            hint={t('proxx.pricing.field_provider_hint')}
          />
        </div>
        <div>
          <div className={styles.editorLabel}>{t('proxx.pricing.prices_label')}</div>
          <div className={styles.editorGrid5}>
            {PRICE_FIELDS.map((field) => (
              <Input
                key={field}
                label={t(`proxx.pricing.col.${field}`)}
                value={prices[field]}
                inputMode="decimal"
                placeholder={t('proxx.pricing.catalog_placeholder')}
                onChange={(event) =>
                  setPrices((current) => ({ ...current, [field]: event.target.value }))
                }
                error={
                  submitted && parsed[field] === undefined
                    ? t('proxx.pricing.error.invalid_price')
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <ToggleSwitch
          checked={override}
          onChange={setOverride}
          label={t('proxx.pricing.field_override')}
        />
        <p className={styles.editorHint}>{t('proxx.pricing.field_override_hint')}</p>
        {formError ? (
          <span className={styles.editorError} role="alert">
            {formError}
          </span>
        ) : null}
      </form>
    </Modal>
  );
}

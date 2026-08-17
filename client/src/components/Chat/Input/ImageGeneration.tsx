import React, { memo, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Image as ImageIcon, Check, ChevronDown } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useRecoilState } from 'recoil';
import { DropdownPopup } from '@librechat/client';
import type { MenuItemProps } from '~/common';
import { useBadgeRowContext } from '~/Providers';
import { IMAGE_MODEL_OPTIONS } from './composerSelectOptions';
import store from '~/store';
import { cn } from '~/utils';

/**
 * Single composer control for image generation: one pill that both toggles
 * image generation on/off and picks the model. Replaces the old separate
 * "Image" toggle + "Image model" dropdown.
 *
 * - on/off lives in ephemeralAgent.image_generation (the badge-row
 *   imageGeneration toggle), which the submit path reads.
 * - the chosen model lives in imageModelByConversation (per-conversation;
 *   empty = fall back to the user-wide default), the same atom
 *   useChatFunctions consumes when sending.
 */
function ImageGeneration() {
  const { imageGeneration, conversationId } = useBadgeRowContext();
  const { toggleState, setToggleState } = imageGeneration;
  const on = toggleState === true;

  const key = conversationId ?? Constants.NEW_CONVO;
  const [model, setModel] = useRecoilState(store.imageModelByConversation(key));
  const [isOpen, setIsOpen] = useState(false);

  // Closed-state label: model name when a specific model is active, otherwise
  // just "Image" (off, or on with the deploy default).
  const displayLabel = useMemo(() => {
    if (on && model) {
      return IMAGE_MODEL_OPTIONS.find((o) => o.value === model)?.label ?? 'Image';
    }
    return 'Image';
  }, [on, model]);

  const items = useMemo<MenuItemProps[]>(() => {
    const checkIcon = (selected: boolean) => (
      <Check className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
    );
    const off: MenuItemProps = {
      label: 'Off',
      ariaChecked: !on,
      onClick: () => setToggleState(false),
      icon: checkIcon(!on),
    };
    const models = IMAGE_MODEL_OPTIONS.map((opt): MenuItemProps => {
      const selected = on && model === opt.value;
      return {
        label: opt.label,
        ariaChecked: selected,
        onClick: () => {
          setToggleState(true);
          setModel(opt.value);
        },
        icon: checkIcon(selected),
      };
    });
    return [off, ...models];
  }, [on, model, setToggleState, setModel]);

  const trigger = (
    <Ariakit.MenuButton
      aria-label="Image generation"
      className={cn(
        'inline-flex h-9 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-sm font-medium',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on
          ? 'bg-[#635BFF]/10 text-[#4F48D9] hover:bg-[#4F48D9]/10 dark:text-[#B9B5FF]'
          : 'bg-transparent text-text-primary hover:bg-surface-hover',
      )}
    >
      <ImageIcon className="icon-sm flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{displayLabel}</span>
      <ChevronDown className="size-3.5 flex-shrink-0 opacity-60" aria-hidden="true" />
    </Ariakit.MenuButton>
  );

  return (
    <DropdownPopup
      menuId="composer-image-menu"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      trigger={trigger}
      items={items}
      portal={true}
      unmountOnHide={true}
      className="max-h-[60vh] overflow-y-auto"
    />
  );
}

export default memo(ImageGeneration);

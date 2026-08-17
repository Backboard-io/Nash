import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { easings } from '@react-spring/web';
import { EModelEndpoint } from 'librechat-data-provider';
import { SplitText } from '@librechat/client';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { useGetEndpointsQuery, useGetStartupConfig, useGetAgentByIdQuery } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import { getIconEndpoint, getEntity } from '~/utils';
import { useSearchParams } from 'react-router-dom';

const greetingTextClass =
  'text-[24px] leading-[36px] md:text-[32px] md:leading-[48px] font-semibold text-[#08090B] dark:text-text-primary pb-[0.2em] -mb-[0.2em]';

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { user } = useAuthContext();
  const localize = useLocalize();
  const [searchParams] = useSearchParams();
  const urlAgentId = searchParams.get('agent_id') || '';
  const { data: urlAgent } = useGetAgentByIdQuery(urlAgentId || null);

  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { entity, isAgent, isAssistant } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  // Fall back to individually fetched agent from URL param when not in agentsMap
  const name = entity?.name ?? urlAgent?.name ?? '';
  const description = (entity?.description || conversation?.greeting) ?? '';

  const getGreeting = useCallback(() => {
    if (typeof startupConfig?.interface?.customWelcome === 'string') {
      const customWelcome = startupConfig.interface.customWelcome;
      // Replace {{user.name}} with actual user name if available
      if (user?.name && customWelcome.includes('{{user.name}}')) {
        return customWelcome.replace(/{{user.name}}/g, user.name);
      }
      return customWelcome;
    }

    const now = new Date();
    const hours = now.getHours();

    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Early morning (midnight to 4:59 AM)
    if (hours >= 0 && hours < 5) {
      return localize('com_ui_late_night');
    }
    // Morning (6 AM to 11:59 AM)
    else if (hours < 12) {
      if (isWeekend) {
        return localize('com_ui_weekend_morning');
      }
      return localize('com_ui_good_morning');
    }
    // Afternoon (12 PM to 4:59 PM)
    else if (hours < 17) {
      return localize('com_ui_good_afternoon');
    }
    // Evening (5 PM to 8:59 PM)
    else {
      return localize('com_ui_good_evening');
    }
  }, [localize, startupConfig?.interface?.customWelcome, user?.name]);

  const handleLineCountChange = useCallback((count: number) => {
    setTextHasMultipleLines(count > 1);
    setLineCount(count);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [lineCount, description]);

  const getDynamicMargin = useMemo(() => {
    let margin = 'mb-0';

    if (lineCount > 2 || (description && description.length > 100)) {
      margin = 'mb-10';
    } else if (lineCount > 1 || (description && description.length > 0)) {
      margin = 'mb-6';
    } else if (textHasMultipleLines) {
      margin = 'mb-4';
    }

    if (contentHeight > 200) {
      margin = 'mb-16';
    } else if (contentHeight > 150) {
      margin = 'mb-12';
    }

    return margin;
  }, [lineCount, description, textHasMultipleLines, contentHeight]);

  const displayName = ((user as any)?.nickname || user?.name || '').split(' ')[0];
  const greetingText =
    typeof startupConfig?.interface?.customWelcome === 'string'
      ? getGreeting()
      : getGreeting() + (displayName ? ', ' + displayName : '');

  return (
    <div
      className={`flex h-full transform-gpu flex-col items-center justify-center pb-16 transition-all duration-200 ${centerFormOnLanding ? 'max-h-full sm:max-h-0' : 'max-h-full'} ${getDynamicMargin}`}
    >
      <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
        <div
          className={`flex ${textHasMultipleLines ? 'flex-col' : 'flex-col md:flex-row'} items-center justify-center gap-2`}
        >
          {((isAgent || isAssistant) && name) || name ? (
            <div className="flex flex-col items-center gap-0 p-2">
              <SplitText
                key={`split-text-${name}`}
                text={name}
                className={greetingTextClass}
                delay={50}
                textAlign="center"
                animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
                animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
                easing={easings.easeOutCubic}
                threshold={0}
                rootMargin="0px"
                onLineCountChange={handleLineCountChange}
              />
            </div>
          ) : (
            <SplitText
              key={`split-text-${greetingText}${user?.name ? '-user' : ''}`}
              text={greetingText}
              className={greetingTextClass}
              delay={50}
              textAlign="center"
              animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
              animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
              easing={easings.easeOutCubic}
              threshold={0}
              rootMargin="0px"
              onLineCountChange={handleLineCountChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

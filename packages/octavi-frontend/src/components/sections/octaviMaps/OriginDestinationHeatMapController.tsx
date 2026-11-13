import React from 'react';
import { withTranslation, WithTranslation } from 'react-i18next';
import type { Status as ResponseStatus } from 'chaire-lib-common/lib/utils/Status';

import * as Status from 'chaire-lib-common/lib/utils/Status';
import { _isBlank } from 'chaire-lib-common/lib/utils/LodashExtensions';
import { LoadingPage } from 'chaire-lib-frontend/lib/components/pages';
import serviceLocator from 'chaire-lib-common/lib/utils/ServiceLocator';
import octaviParameters from 'octavi-legacy/lib/services/ui/OctaviParameters';
import { buildWidgetFilter, getDatesForPeriodAggregation, getFilterIdx } from 'octavi-legacy/lib/services/ui/utils';
import {
    getLocalStorageKey,
    loadLocalStorageFromFilter,
    saveLocalStorageDataFromFilter
} from 'octavi-legacy/lib/services/ui/localStorageManager';
import OriginDestinationHeatMap, {
    HeatmapFeature,
    HeatmapFeatureCollection,
    HeatmapStop
} from './OriginDestinationHeatMap';

const COLOR_STOPS = ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'];
const DATA_TYPE = 'totalCountGraph';
const DEFAULT_DURATION_DIVIDER = 60;

interface MapOptions {
    selectedMapStyle?: string;
    selectedMapWidget?: string;
    selectedMapObject?: string;
    temporalOption?: string;
    objectOption?: string;
}

interface MapFilter {
    name: string;
    calendarStartAt?: string | null;
    calendarEndAt?: string | null;
    [key: string]: unknown;
}

interface QueryScaleOptions {
    type?: string;
}

interface QueryResponse {
    counts?: Record<string, unknown>;
}

interface PeriodDate {
    clone(): PeriodDate;
    tz(timeZone: string): PeriodDate;
    unix(): number;
}

interface ActiveQuery {
    progressName: string;
}

interface ControllerState {
    zones: HeatmapFeatureCollection;
    heatmapData: HeatmapFeatureCollection;
    stops: HeatmapStop[];
    mapOptions: MapOptions;
    scaleType: string;
    isEnabled: boolean;
    counts?: Record<string, unknown>;
    legendTitle?: string;
}

interface WidgetOptions {
    geographicalOption: 'bySR' | 'bySM';
    onLocationOption: 'origin' | 'destination';
    object: string;
    temporalOption?: string;
    objectOption?: string;
}

const EMPTY_FEATURE_COLLECTION: HeatmapFeatureCollection = { type: 'FeatureCollection', features: [] };

class OriginDestinationHeatMapController extends React.Component<WithTranslation, ControllerState> {
    private queryId = 0;
    private activeQuery: ActiveQuery | null = null;

    constructor(props: WithTranslation) {
        super(props);
        this.state = {
            zones: EMPTY_FEATURE_COLLECTION,
            heatmapData: EMPTY_FEATURE_COLLECTION,
            stops: [],
            mapOptions: octaviParameters.mapOptions as MapOptions,
            scaleType: octaviParameters.get('selectedScale', 'intervalBased') as string,
            isEnabled: serviceLocator.collectionManager.has('zones')
        };
    }

    componentDidMount(): void {
        serviceLocator.eventManager.on('taxi.filter.submit', this.updateHeatmapData);
        serviceLocator.eventManager.on('taxi.filter.selectedMapOptions.update', this.onMapOptionsChange);
        serviceLocator.eventManager.on('taxi.filter.selectedScale.update', this.onScaleChange);
        serviceLocator.eventManager.on('taxi.filter.spatial.enable', this.onZonesAvailable);
        serviceLocator.eventManager.on('taxi.dataSources.loaded', this.updateHeatmapData);

        if (serviceLocator.collectionManager.has('zones')) {
            this.onZonesAvailable();
        }
    }

    componentWillUnmount(): void {
        this.queryId += 1;
        this.finishActiveQuery();
        serviceLocator.eventManager.off('taxi.filter.submit', this.updateHeatmapData);
        serviceLocator.eventManager.off('taxi.filter.selectedMapOptions.update', this.onMapOptionsChange);
        serviceLocator.eventManager.off('taxi.filter.selectedScale.update', this.onScaleChange);
        serviceLocator.eventManager.off('taxi.filter.spatial.enable', this.onZonesAvailable);
        serviceLocator.eventManager.off('taxi.dataSources.loaded', this.updateHeatmapData);
    }

    private getZones = (): HeatmapFeatureCollection => {
        if (!serviceLocator.collectionManager.has('zones')) {
            return EMPTY_FEATURE_COLLECTION;
        }

        const collection = serviceLocator.collectionManager.get('zones');
        const features = collection.features as HeatmapFeature[];
        return {
            type: 'FeatureCollection',
            features: features.map((feature) => ({
                ...feature,
                properties: {
                    ...feature.properties,
                    ...(feature.properties.data || {})
                }
            }))
        };
    };

    private finishActiveQuery = (): void => {
        if (this.activeQuery) {
            serviceLocator.eventManager.emit('progress', { name: this.activeQuery.progressName, progress: 1 });
            this.activeQuery = null;
        }
    };

    private onZonesAvailable = (): void => {
        this.setState({ zones: this.getZones(), isEnabled: true }, this.updateHeatmapData);
    };

    private onMapOptionsChange = (mapOptions?: MapOptions): void => {
        this.setState(
            { mapOptions: mapOptions || (octaviParameters.mapOptions as MapOptions) },
            this.updateHeatmapData
        );
    };

    private onScaleChange = (scaleOptions?: QueryScaleOptions): void => {
        const scaleType = scaleOptions?.type || (octaviParameters.get('selectedScale', 'intervalBased') as string);
        this.setState({ scaleType }, () => this.updateDisplayData(this.state.counts || {}));
    };

    private getWidgetOptions = (): WidgetOptions => ({
        geographicalOption: this.state.mapOptions.selectedMapStyle === 'SRMap' ? 'bySR' : 'bySM',
        onLocationOption: this.state.mapOptions.selectedMapWidget === 'destinationMap' ? 'destination' : 'origin',
        object: this.state.mapOptions.selectedMapObject || 'activities',
        temporalOption: this.state.mapOptions.temporalOption,
        objectOption: this.state.mapOptions.objectOption
    });

    private getLegendTitle = (): string => {
        const options = this.getWidgetOptions();
        const translate = this.props.t;
        let title = translate(`octavi:widgets.${options.object}.count`);
        if (!_isBlank(options.objectOption) && options.objectOption !== 'none') {
            title += ` ${translate(`octavi:widgetOptions:objectOption:${options.objectOption}`).toLowerCase()}`;
        }
        title += ` ${translate(`octavi:widgetOptions:geographicalOption:${options.geographicalOption}`).toLowerCase()}`;
        title += ` (${translate(`octavi:widgetOptions:onLocationOption:${options.onLocationOption}`).toLowerCase()})`;
        if (!_isBlank(options.temporalOption) && options.temporalOption !== 'none') {
            title += ` ${translate(`octavi:widgetOptions:temporalOption:${options.temporalOption}`).toLowerCase()}`;
        }
        return title;
    };

    private buildStops = (values: number[]): HeatmapStop[] => {
        if (values.length === 0) {
            return [];
        }

        const sortedValues = [...values].sort((a, b) => a - b);
        const minValue = sortedValues[0];
        const maxValue = sortedValues[sortedValues.length - 1];
        const upperBound = minValue === maxValue ? minValue + 1 : maxValue;
        const breakpoints =
            this.state.scaleType === 'distributionBased' && minValue !== maxValue
                ? Array.from({ length: COLOR_STOPS.length + 1 }, (_, index) => {
                    const quantileIndex = Math.floor((index / COLOR_STOPS.length) * (sortedValues.length - 1));
                    return sortedValues[quantileIndex];
                })
                : Array.from(
                    { length: COLOR_STOPS.length + 1 },
                    (_, index) => minValue + ((upperBound - minValue) * index) / COLOR_STOPS.length
                );

        const stops = COLOR_STOPS.map((color, index) => ({
            value: breakpoints[index],
            color,
            label: `${breakpoints[index].toFixed(1)} - ${breakpoints[index + 1].toFixed(1)}`
        })).filter((stop, index, allStops) => index === 0 || stop.value > allStops[index - 1].value);

        if (stops.length < 2) {
            return [
                { value: minValue, color: COLOR_STOPS[0], label: `${minValue.toFixed(1)} - ${upperBound.toFixed(1)}` },
                {
                    value: upperBound,
                    color: COLOR_STOPS[COLOR_STOPS.length - 1],
                    label: `${upperBound.toFixed(1)}+`
                }
            ];
        }
        return stops;
    };

    private updateDisplayData = (counts: Record<string, unknown>): void => {
        const zoneProperty = this.state.mapOptions.selectedMapStyle === 'SRMap' ? 'SR' : 'SM';
        const values = Object.values(counts).map(Number).filter(Number.isFinite);
        const heatmapData: HeatmapFeatureCollection = {
            ...this.state.zones,
            features: this.state.zones.features.map((feature) => {
                const zoneKey = feature.properties[zoneProperty];
                const value = Number(counts[String(zoneKey)] ?? 0);
                return {
                    ...feature,
                    properties: {
                        ...feature.properties,
                        value: Number.isFinite(value) ? value : 0
                    }
                };
            })
        };

        this.setState({
            counts,
            heatmapData,
            stops: this.buildStops(values),
            legendTitle: this.getLegendTitle()
        });
    };

    private updateHeatmapData = (): void => {
        this.finishActiveQuery();
        const queryId = ++this.queryId;
        if (!this.state.isEnabled || this.state.zones.features.length === 0) {
            return;
        }

        const filters = octaviParameters.filters as MapFilter[];
        const filterIndex = getFilterIdx(filters, 'FilterOne') as number;
        if (filterIndex < 0) {
            console.error('Cannot update the Octavi map: FilterOne is missing.');
            return;
        }
        const filter = filters[filterIndex];
        if (!filter.calendarStartAt || !filter.calendarEndAt) {
            this.updateDisplayData({});
            return;
        }

        const widgetOptions = this.getWidgetOptions();
        if (_isBlank(widgetOptions.object) || widgetOptions.object === 'none') {
            this.updateDisplayData({});
            return;
        }
        const dataSourceIds = octaviParameters.dataSourceIds as string[];
        if (dataSourceIds.length === 0) {
            return;
        }

        const filterKey = getLocalStorageKey(filters, 'FilterOne', widgetOptions) as string;
        const cachedCounts = loadLocalStorageFromFilter(filterKey, widgetOptions.object, DATA_TYPE) as Record<
            string,
            unknown
        > | null;
        if (cachedCounts) {
            this.updateDisplayData(cachedCounts);
            return;
        }

        const dates = getDatesForPeriodAggregation(
            filter.calendarStartAt,
            filter.calendarEndAt,
            widgetOptions.temporalOption
        ) as { periodStart: PeriodDate; periodEnd: PeriodDate };
        const isContinuous = widgetOptions.object === 'distance' || widgetOptions.object === 'duration';
        const divider =
            widgetOptions.object === 'distance'
                ? 1000
                : widgetOptions.object === 'duration'
                    ? DEFAULT_DURATION_DIVIDER
                    : null;
        const progressName = `OctaviLoading${widgetOptions.object[0].toUpperCase()}${widgetOptions.object.slice(1)}TotalCountGraph`;
        this.activeQuery = { progressName };
        serviceLocator.eventManager.emit('progress', { name: progressName, progress: 0 });

        serviceLocator.socketEventManager.emit(
            'taxi.totalCount.byZone.timeRange',
            {
                object: widgetOptions.object,
                customFilterString: ['activities', 'distance', 'duration'].includes(widgetOptions.object)
                    ? ' AND status = \'occupied\' '
                    : null,
                dataSourceIds,
                startAt: dates.periodStart.clone().tz('utc').unix(),
                endAt: dates.periodEnd.clone().tz('utc').unix(),
                filters: buildWidgetFilter(filters, 'FilterOne', widgetOptions.object, widgetOptions),
                type: isContinuous ? 'continuous' : 'discrete',
                widgetSpecs: {
                    object: widgetOptions.object,
                    type: isContinuous ? 'continuous' : 'discrete',
                    divider
                }
            },
            (responseStatus: ResponseStatus<QueryResponse>) => {
                if (queryId !== this.queryId) {
                    return;
                }

                try {
                    if (!Status.isStatusOk(responseStatus)) {
                        console.error('Failed to retrieve Octavi map data:', responseStatus);
                        this.updateDisplayData({});
                        return;
                    }
                    const response = Status.unwrap(responseStatus) as QueryResponse;
                    if (!response.counts || typeof response.counts !== 'object' || Array.isArray(response.counts)) {
                        console.error('The Octavi map query returned an invalid counts result:', response);
                        this.updateDisplayData({});
                        return;
                    }
                    saveLocalStorageDataFromFilter(filterKey, widgetOptions.object, response.counts, DATA_TYPE);
                    this.updateDisplayData(response.counts);
                } finally {
                    this.finishActiveQuery();
                }
            }
        );
    };

    render(): React.ReactNode {
        if (!this.state.isEnabled) {
            return <LoadingPage />;
        }

        return (
            <div style={{ width: '100%', height: '100%' }}>
                <OriginDestinationHeatMap
                    data={this.state.heatmapData}
                    property="value"
                    stops={this.state.stops}
                    legendTitle={this.state.legendTitle}
                />
            </div>
        );
    }
}

export default withTranslation()(OriginDestinationHeatMapController);

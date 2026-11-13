import React from 'react';
import { withTranslation } from 'react-i18next';

import * as Status from 'chaire-lib-common/lib/utils/Status';
import { _isBlank } from 'chaire-lib-common/lib/utils/LodashExtensions';
import { LoadingPage } from 'chaire-lib-frontend/lib/components/pages';
import serviceLocator from 'chaire-lib-common/lib/utils/ServiceLocator';
import OriginDestinationHeatMap from './OriginDestinationHeatMap';
import octaviParameters from '../../services/ui/OctaviParameters';
import { buildWidgetFilter, getDatesForPeriodAggregation, getFilterIdx } from '../../services/ui/utils';
import {
    getLocalStorageKey,
    loadLocalStorageFromFilter,
    saveLocalStorageDataFromFilter
} from '../../services/ui/localStorageManager';

const COLOR_STOPS = ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'];
const DATA_TYPE = 'totalCountGraph';
const DEFAULT_DURATION_DIVIDER = 60;

class OriginDestinationHeatMapController extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            zones: { type: 'FeatureCollection', features: [] },
            heatmapData: { type: 'FeatureCollection', features: [] },
            stops: [],
            mapOptions: octaviParameters.mapOptions,
            scaleType: octaviParameters.get('selectedScale', 'intervalBased'),
            isEnabled: serviceLocator.collectionManager.has('zones')
        };
        this.queryId = 0;
        this.activeQuery = null;
    }

    componentDidMount() {
        serviceLocator.eventManager.on('taxi.filter.submit', this.updateHeatmapData);
        serviceLocator.eventManager.on('taxi.filter.selectedMapOptions.update', this.onMapOptionsChange);
        serviceLocator.eventManager.on('taxi.filter.selectedScale.update', this.onScaleChange);
        serviceLocator.eventManager.on('taxi.filter.spatial.enable', this.onZonesAvailable);
        serviceLocator.eventManager.on('taxi.dataSources.loaded', this.updateHeatmapData);

        if (serviceLocator.collectionManager.has('zones')) {
            this.onZonesAvailable();
        }
    }

    componentWillUnmount() {
        this.queryId += 1;
        this.finishActiveQuery();
        serviceLocator.eventManager.off('taxi.filter.submit', this.updateHeatmapData);
        serviceLocator.eventManager.off('taxi.filter.selectedMapOptions.update', this.onMapOptionsChange);
        serviceLocator.eventManager.off('taxi.filter.selectedScale.update', this.onScaleChange);
        serviceLocator.eventManager.off('taxi.filter.spatial.enable', this.onZonesAvailable);
        serviceLocator.eventManager.off('taxi.dataSources.loaded', this.updateHeatmapData);
    }

    getZones = () => {
        if (!serviceLocator.collectionManager.has('zones')) {
            return { type: 'FeatureCollection', features: [] };
        }
        const collection = serviceLocator.collectionManager.get('zones');
        return {
            type: 'FeatureCollection',
            features: collection.features.map((feature) => ({
                ...feature,
                properties: {
                    ...feature.properties,
                    ...(feature.properties.data || {})
                }
            }))
        };
    };

    finishActiveQuery = () => {
        if (this.activeQuery) {
            serviceLocator.eventManager.emit('progress', { name: this.activeQuery.progressName, progress: 1 });
            this.activeQuery = null;
        }
    };

    onZonesAvailable = () => {
        this.setState({ zones: this.getZones(), isEnabled: true }, this.updateHeatmapData);
    };

    onMapOptionsChange = (mapOptions) => {
        const options = mapOptions || octaviParameters.mapOptions;
        this.setState({ mapOptions: options }, this.updateHeatmapData);
    };

    onScaleChange = (scaleOptions) => {
        const scaleType = scaleOptions?.type || octaviParameters.get('selectedScale', 'intervalBased');
        this.setState({ scaleType }, () => this.updateDisplayData(this.state.counts || {}));
    };

    getWidgetOptions = () => ({
        geographicalOption: this.state.mapOptions.selectedMapStyle === 'SRMap' ? 'bySR' : 'bySM',
        onLocationOption: this.state.mapOptions.selectedMapWidget === 'destinationMap' ? 'destination' : 'origin',
        object: this.state.mapOptions.selectedMapObject,
        temporalOption: this.state.mapOptions.temporalOption,
        objectOption: this.state.mapOptions.objectOption
    });

    getLegendTitle = () => {
        const { t } = this.props;
        const options = this.getWidgetOptions();
        let title = t(`octavi:widgets.${options.object}.count`);
        if (!_isBlank(options.objectOption) && options.objectOption !== 'none') {
            title += ` ${t(`octavi:widgetOptions:objectOption:${options.objectOption}`).toLowerCase()}`;
        }
        if (!_isBlank(options.geographicalOption)) {
            title += ` ${t(`octavi:widgetOptions:geographicalOption:${options.geographicalOption}`).toLowerCase()}`;
            title += ` (${t(`octavi:widgetOptions:onLocationOption:${options.onLocationOption}`).toLowerCase()})`;
        }
        if (!_isBlank(options.temporalOption) && options.temporalOption !== 'none') {
            title += ` ${t(`octavi:widgetOptions:temporalOption:${options.temporalOption}`).toLowerCase()}`;
        }
        return title;
    };

    buildStops = (values) => {
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
                { value: upperBound, color: COLOR_STOPS[COLOR_STOPS.length - 1], label: `${upperBound.toFixed(1)}+` }
            ];
        }
        return stops;
    };

    updateDisplayData = (counts) => {
        const zoneProperty = this.state.mapOptions.selectedMapStyle === 'SRMap' ? 'SR' : 'SM';
        const values = Object.values(counts).map(Number).filter(Number.isFinite);
        const heatmapData = {
            ...this.state.zones,
            features: this.state.zones.features.map((feature) => {
                const zoneKey = feature.properties[zoneProperty];
                const value = Number(counts[zoneKey] ?? 0);
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

    updateHeatmapData = () => {
        this.finishActiveQuery();
        const queryId = ++this.queryId;
        if (!this.state.isEnabled || this.state.zones.features.length === 0) {
            return;
        }

        const filters = octaviParameters.filters;
        const filterIndex = getFilterIdx(filters, 'FilterOne');
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
        const dataSourceIds = octaviParameters.dataSourceIds;
        if (dataSourceIds.length === 0) {
            return;
        }

        const filterKey = getLocalStorageKey(filters, 'FilterOne', widgetOptions);
        const cachedCounts = loadLocalStorageFromFilter(filterKey, widgetOptions.object, DATA_TYPE);
        if (cachedCounts) {
            this.updateDisplayData(cachedCounts);
            return;
        }

        const dates = getDatesForPeriodAggregation(
            filter.calendarStartAt,
            filter.calendarEndAt,
            widgetOptions.temporalOption
        );
        const isContinuous = widgetOptions.object === 'distance' || widgetOptions.object === 'duration';
        const divider =
            widgetOptions.object === 'distance'
                ? 1000
                : widgetOptions.object === 'duration'
                  ? DEFAULT_DURATION_DIVIDER
                  : null;
        const progressName = `OctaviLoading${widgetOptions.object[0].toUpperCase()}${widgetOptions.object.slice(1)}TotalCountGraph`;
        this.activeQuery = { queryId, progressName };
        serviceLocator.eventManager.emit('progress', { name: progressName, progress: 0 });

        serviceLocator.socketEventManager.emit(
            'taxi.totalCount.byZone.timeRange',
            {
                object: widgetOptions.object,
                customFilterString: ['activities', 'distance', 'duration'].includes(widgetOptions.object)
                    ? " AND status = 'occupied' "
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
            (responseStatus) => {
                if (queryId !== this.queryId) {
                    return;
                }

                try {
                    if (!Status.isStatusOk(responseStatus)) {
                        console.error('Failed to retrieve Octavi map data:', responseStatus);
                        this.updateDisplayData({});
                        return;
                    }
                    const response = Status.unwrap(responseStatus);
                    if (!response?.counts || typeof response.counts !== 'object') {
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

    render() {
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

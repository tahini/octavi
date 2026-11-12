import type { FeatureCollection } from 'geojson';

export interface ZoneMapSelection {
    id: string;
    ids: Array<string | number>;
    color?: string;
    opacity?: number;
}

export interface HeatmapStop {
    value: number;
    color: string;
}

export interface ZoneMapLayersProps {
    data?: FeatureCollection;
    fillColor?: string | unknown[];
    fillOpacity?: number;
    lineColor?: string;
    selections?: ZoneMapSelection[];
    heatmapProperty?: string;
    heatmapStops?: HeatmapStop[];
}

declare const ZoneMapLayers: (props: ZoneMapLayersProps) => JSX.Element;
export default ZoneMapLayers;

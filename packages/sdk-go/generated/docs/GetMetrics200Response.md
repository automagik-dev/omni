# GetMetrics200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Gauges** | Pointer to **map[string]float32** |  | [optional] 
**Counters** | Pointer to **map[string]float32** |  | [optional] 
**Histograms** | Pointer to **map[string]interface{}** |  | [optional] 

## Methods

### NewGetMetrics200Response

`func NewGetMetrics200Response() *GetMetrics200Response`

NewGetMetrics200Response instantiates a new GetMetrics200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetMetrics200ResponseWithDefaults

`func NewGetMetrics200ResponseWithDefaults() *GetMetrics200Response`

NewGetMetrics200ResponseWithDefaults instantiates a new GetMetrics200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetGauges

`func (o *GetMetrics200Response) GetGauges() map[string]float32`

GetGauges returns the Gauges field if non-nil, zero value otherwise.

### GetGaugesOk

`func (o *GetMetrics200Response) GetGaugesOk() (*map[string]float32, bool)`

GetGaugesOk returns a tuple with the Gauges field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetGauges

`func (o *GetMetrics200Response) SetGauges(v map[string]float32)`

SetGauges sets Gauges field to given value.

### HasGauges

`func (o *GetMetrics200Response) HasGauges() bool`

HasGauges returns a boolean if a field has been set.

### GetCounters

`func (o *GetMetrics200Response) GetCounters() map[string]float32`

GetCounters returns the Counters field if non-nil, zero value otherwise.

### GetCountersOk

`func (o *GetMetrics200Response) GetCountersOk() (*map[string]float32, bool)`

GetCountersOk returns a tuple with the Counters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCounters

`func (o *GetMetrics200Response) SetCounters(v map[string]float32)`

SetCounters sets Counters field to given value.

### HasCounters

`func (o *GetMetrics200Response) HasCounters() bool`

HasCounters returns a boolean if a field has been set.

### GetHistograms

`func (o *GetMetrics200Response) GetHistograms() map[string]interface{}`

GetHistograms returns the Histograms field if non-nil, zero value otherwise.

### GetHistogramsOk

`func (o *GetMetrics200Response) GetHistogramsOk() (*map[string]interface{}, bool)`

GetHistogramsOk returns a tuple with the Histograms field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHistograms

`func (o *GetMetrics200Response) SetHistograms(v map[string]interface{})`

SetHistograms sets Histograms field to given value.

### HasHistograms

`func (o *GetMetrics200Response) HasHistograms() bool`

HasHistograms returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



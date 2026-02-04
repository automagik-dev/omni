# GetEventMetrics200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Total** | **int32** | Total events | 
**Today** | **int32** | Events today | 
**ByType** | **map[string]float32** | Count by type | 
**ByChannel** | **map[string]float32** | Count by channel | 
**AvgProcessingTime** | **float32** | Avg processing time (ms) | 

## Methods

### NewGetEventMetrics200ResponseData

`func NewGetEventMetrics200ResponseData(total int32, today int32, byType map[string]float32, byChannel map[string]float32, avgProcessingTime float32, ) *GetEventMetrics200ResponseData`

NewGetEventMetrics200ResponseData instantiates a new GetEventMetrics200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEventMetrics200ResponseDataWithDefaults

`func NewGetEventMetrics200ResponseDataWithDefaults() *GetEventMetrics200ResponseData`

NewGetEventMetrics200ResponseDataWithDefaults instantiates a new GetEventMetrics200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotal

`func (o *GetEventMetrics200ResponseData) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *GetEventMetrics200ResponseData) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *GetEventMetrics200ResponseData) SetTotal(v int32)`

SetTotal sets Total field to given value.


### GetToday

`func (o *GetEventMetrics200ResponseData) GetToday() int32`

GetToday returns the Today field if non-nil, zero value otherwise.

### GetTodayOk

`func (o *GetEventMetrics200ResponseData) GetTodayOk() (*int32, bool)`

GetTodayOk returns a tuple with the Today field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetToday

`func (o *GetEventMetrics200ResponseData) SetToday(v int32)`

SetToday sets Today field to given value.


### GetByType

`func (o *GetEventMetrics200ResponseData) GetByType() map[string]float32`

GetByType returns the ByType field if non-nil, zero value otherwise.

### GetByTypeOk

`func (o *GetEventMetrics200ResponseData) GetByTypeOk() (*map[string]float32, bool)`

GetByTypeOk returns a tuple with the ByType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByType

`func (o *GetEventMetrics200ResponseData) SetByType(v map[string]float32)`

SetByType sets ByType field to given value.


### GetByChannel

`func (o *GetEventMetrics200ResponseData) GetByChannel() map[string]float32`

GetByChannel returns the ByChannel field if non-nil, zero value otherwise.

### GetByChannelOk

`func (o *GetEventMetrics200ResponseData) GetByChannelOk() (*map[string]float32, bool)`

GetByChannelOk returns a tuple with the ByChannel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByChannel

`func (o *GetEventMetrics200ResponseData) SetByChannel(v map[string]float32)`

SetByChannel sets ByChannel field to given value.


### GetAvgProcessingTime

`func (o *GetEventMetrics200ResponseData) GetAvgProcessingTime() float32`

GetAvgProcessingTime returns the AvgProcessingTime field if non-nil, zero value otherwise.

### GetAvgProcessingTimeOk

`func (o *GetEventMetrics200ResponseData) GetAvgProcessingTimeOk() (*float32, bool)`

GetAvgProcessingTimeOk returns a tuple with the AvgProcessingTime field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAvgProcessingTime

`func (o *GetEventMetrics200ResponseData) SetAvgProcessingTime(v float32)`

SetAvgProcessingTime sets AvgProcessingTime field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



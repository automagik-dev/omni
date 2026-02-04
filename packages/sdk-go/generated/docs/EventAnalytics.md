# EventAnalytics

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalEvents** | **int32** | Total event count | 
**ByEventType** | **map[string]float32** | Count by event type | 
**ByChannel** | **map[string]float32** | Count by channel | 
**ByDirection** | [**GetEventAnalytics200ResponseByDirection**](GetEventAnalytics200ResponseByDirection.md) |  | 

## Methods

### NewEventAnalytics

`func NewEventAnalytics(totalEvents int32, byEventType map[string]float32, byChannel map[string]float32, byDirection GetEventAnalytics200ResponseByDirection, ) *EventAnalytics`

NewEventAnalytics instantiates a new EventAnalytics object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewEventAnalyticsWithDefaults

`func NewEventAnalyticsWithDefaults() *EventAnalytics`

NewEventAnalyticsWithDefaults instantiates a new EventAnalytics object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotalEvents

`func (o *EventAnalytics) GetTotalEvents() int32`

GetTotalEvents returns the TotalEvents field if non-nil, zero value otherwise.

### GetTotalEventsOk

`func (o *EventAnalytics) GetTotalEventsOk() (*int32, bool)`

GetTotalEventsOk returns a tuple with the TotalEvents field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalEvents

`func (o *EventAnalytics) SetTotalEvents(v int32)`

SetTotalEvents sets TotalEvents field to given value.


### GetByEventType

`func (o *EventAnalytics) GetByEventType() map[string]float32`

GetByEventType returns the ByEventType field if non-nil, zero value otherwise.

### GetByEventTypeOk

`func (o *EventAnalytics) GetByEventTypeOk() (*map[string]float32, bool)`

GetByEventTypeOk returns a tuple with the ByEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByEventType

`func (o *EventAnalytics) SetByEventType(v map[string]float32)`

SetByEventType sets ByEventType field to given value.


### GetByChannel

`func (o *EventAnalytics) GetByChannel() map[string]float32`

GetByChannel returns the ByChannel field if non-nil, zero value otherwise.

### GetByChannelOk

`func (o *EventAnalytics) GetByChannelOk() (*map[string]float32, bool)`

GetByChannelOk returns a tuple with the ByChannel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByChannel

`func (o *EventAnalytics) SetByChannel(v map[string]float32)`

SetByChannel sets ByChannel field to given value.


### GetByDirection

`func (o *EventAnalytics) GetByDirection() GetEventAnalytics200ResponseByDirection`

GetByDirection returns the ByDirection field if non-nil, zero value otherwise.

### GetByDirectionOk

`func (o *EventAnalytics) GetByDirectionOk() (*GetEventAnalytics200ResponseByDirection, bool)`

GetByDirectionOk returns a tuple with the ByDirection field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByDirection

`func (o *EventAnalytics) SetByDirection(v GetEventAnalytics200ResponseByDirection)`

SetByDirection sets ByDirection field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



# DeadLetterStats

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Total** | **int32** | Total count | 
**Pending** | **int32** | Pending count | 
**Retrying** | **int32** | Retrying count | 
**Resolved** | **int32** | Resolved count | 
**Abandoned** | **int32** | Abandoned count | 
**ByEventType** | **map[string]float32** | Count by event type | 

## Methods

### NewDeadLetterStats

`func NewDeadLetterStats(total int32, pending int32, retrying int32, resolved int32, abandoned int32, byEventType map[string]float32, ) *DeadLetterStats`

NewDeadLetterStats instantiates a new DeadLetterStats object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewDeadLetterStatsWithDefaults

`func NewDeadLetterStatsWithDefaults() *DeadLetterStats`

NewDeadLetterStatsWithDefaults instantiates a new DeadLetterStats object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotal

`func (o *DeadLetterStats) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *DeadLetterStats) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *DeadLetterStats) SetTotal(v int32)`

SetTotal sets Total field to given value.


### GetPending

`func (o *DeadLetterStats) GetPending() int32`

GetPending returns the Pending field if non-nil, zero value otherwise.

### GetPendingOk

`func (o *DeadLetterStats) GetPendingOk() (*int32, bool)`

GetPendingOk returns a tuple with the Pending field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPending

`func (o *DeadLetterStats) SetPending(v int32)`

SetPending sets Pending field to given value.


### GetRetrying

`func (o *DeadLetterStats) GetRetrying() int32`

GetRetrying returns the Retrying field if non-nil, zero value otherwise.

### GetRetryingOk

`func (o *DeadLetterStats) GetRetryingOk() (*int32, bool)`

GetRetryingOk returns a tuple with the Retrying field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetrying

`func (o *DeadLetterStats) SetRetrying(v int32)`

SetRetrying sets Retrying field to given value.


### GetResolved

`func (o *DeadLetterStats) GetResolved() int32`

GetResolved returns the Resolved field if non-nil, zero value otherwise.

### GetResolvedOk

`func (o *DeadLetterStats) GetResolvedOk() (*int32, bool)`

GetResolvedOk returns a tuple with the Resolved field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolved

`func (o *DeadLetterStats) SetResolved(v int32)`

SetResolved sets Resolved field to given value.


### GetAbandoned

`func (o *DeadLetterStats) GetAbandoned() int32`

GetAbandoned returns the Abandoned field if non-nil, zero value otherwise.

### GetAbandonedOk

`func (o *DeadLetterStats) GetAbandonedOk() (*int32, bool)`

GetAbandonedOk returns a tuple with the Abandoned field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAbandoned

`func (o *DeadLetterStats) SetAbandoned(v int32)`

SetAbandoned sets Abandoned field to given value.


### GetByEventType

`func (o *DeadLetterStats) GetByEventType() map[string]float32`

GetByEventType returns the ByEventType field if non-nil, zero value otherwise.

### GetByEventTypeOk

`func (o *DeadLetterStats) GetByEventTypeOk() (*map[string]float32, bool)`

GetByEventTypeOk returns a tuple with the ByEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByEventType

`func (o *DeadLetterStats) SetByEventType(v map[string]float32)`

SetByEventType sets ByEventType field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



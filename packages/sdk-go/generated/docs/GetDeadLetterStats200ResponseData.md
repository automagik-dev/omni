# GetDeadLetterStats200ResponseData

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

### NewGetDeadLetterStats200ResponseData

`func NewGetDeadLetterStats200ResponseData(total int32, pending int32, retrying int32, resolved int32, abandoned int32, byEventType map[string]float32, ) *GetDeadLetterStats200ResponseData`

NewGetDeadLetterStats200ResponseData instantiates a new GetDeadLetterStats200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetDeadLetterStats200ResponseDataWithDefaults

`func NewGetDeadLetterStats200ResponseDataWithDefaults() *GetDeadLetterStats200ResponseData`

NewGetDeadLetterStats200ResponseDataWithDefaults instantiates a new GetDeadLetterStats200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotal

`func (o *GetDeadLetterStats200ResponseData) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *GetDeadLetterStats200ResponseData) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *GetDeadLetterStats200ResponseData) SetTotal(v int32)`

SetTotal sets Total field to given value.


### GetPending

`func (o *GetDeadLetterStats200ResponseData) GetPending() int32`

GetPending returns the Pending field if non-nil, zero value otherwise.

### GetPendingOk

`func (o *GetDeadLetterStats200ResponseData) GetPendingOk() (*int32, bool)`

GetPendingOk returns a tuple with the Pending field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPending

`func (o *GetDeadLetterStats200ResponseData) SetPending(v int32)`

SetPending sets Pending field to given value.


### GetRetrying

`func (o *GetDeadLetterStats200ResponseData) GetRetrying() int32`

GetRetrying returns the Retrying field if non-nil, zero value otherwise.

### GetRetryingOk

`func (o *GetDeadLetterStats200ResponseData) GetRetryingOk() (*int32, bool)`

GetRetryingOk returns a tuple with the Retrying field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetrying

`func (o *GetDeadLetterStats200ResponseData) SetRetrying(v int32)`

SetRetrying sets Retrying field to given value.


### GetResolved

`func (o *GetDeadLetterStats200ResponseData) GetResolved() int32`

GetResolved returns the Resolved field if non-nil, zero value otherwise.

### GetResolvedOk

`func (o *GetDeadLetterStats200ResponseData) GetResolvedOk() (*int32, bool)`

GetResolvedOk returns a tuple with the Resolved field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolved

`func (o *GetDeadLetterStats200ResponseData) SetResolved(v int32)`

SetResolved sets Resolved field to given value.


### GetAbandoned

`func (o *GetDeadLetterStats200ResponseData) GetAbandoned() int32`

GetAbandoned returns the Abandoned field if non-nil, zero value otherwise.

### GetAbandonedOk

`func (o *GetDeadLetterStats200ResponseData) GetAbandonedOk() (*int32, bool)`

GetAbandonedOk returns a tuple with the Abandoned field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAbandoned

`func (o *GetDeadLetterStats200ResponseData) SetAbandoned(v int32)`

SetAbandoned sets Abandoned field to given value.


### GetByEventType

`func (o *GetDeadLetterStats200ResponseData) GetByEventType() map[string]float32`

GetByEventType returns the ByEventType field if non-nil, zero value otherwise.

### GetByEventTypeOk

`func (o *GetDeadLetterStats200ResponseData) GetByEventTypeOk() (*map[string]float32, bool)`

GetByEventTypeOk returns a tuple with the ByEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByEventType

`func (o *GetDeadLetterStats200ResponseData) SetByEventType(v map[string]float32)`

SetByEventType sets ByEventType field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



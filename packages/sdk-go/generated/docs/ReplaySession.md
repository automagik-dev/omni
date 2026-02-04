# ReplaySession

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Session UUID | 
**Status** | **string** | Status | 
**Options** | [**ListReplaySessions200ResponseItemsInnerOptions**](ListReplaySessions200ResponseItemsInnerOptions.md) |  | 
**Progress** | [**ListReplaySessions200ResponseItemsInnerProgress**](ListReplaySessions200ResponseItemsInnerProgress.md) |  | 

## Methods

### NewReplaySession

`func NewReplaySession(id string, status string, options ListReplaySessions200ResponseItemsInnerOptions, progress ListReplaySessions200ResponseItemsInnerProgress, ) *ReplaySession`

NewReplaySession instantiates a new ReplaySession object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewReplaySessionWithDefaults

`func NewReplaySessionWithDefaults() *ReplaySession`

NewReplaySessionWithDefaults instantiates a new ReplaySession object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ReplaySession) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ReplaySession) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ReplaySession) SetId(v string)`

SetId sets Id field to given value.


### GetStatus

`func (o *ReplaySession) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ReplaySession) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ReplaySession) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetOptions

`func (o *ReplaySession) GetOptions() ListReplaySessions200ResponseItemsInnerOptions`

GetOptions returns the Options field if non-nil, zero value otherwise.

### GetOptionsOk

`func (o *ReplaySession) GetOptionsOk() (*ListReplaySessions200ResponseItemsInnerOptions, bool)`

GetOptionsOk returns a tuple with the Options field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOptions

`func (o *ReplaySession) SetOptions(v ListReplaySessions200ResponseItemsInnerOptions)`

SetOptions sets Options field to given value.


### GetProgress

`func (o *ReplaySession) GetProgress() ListReplaySessions200ResponseItemsInnerProgress`

GetProgress returns the Progress field if non-nil, zero value otherwise.

### GetProgressOk

`func (o *ReplaySession) GetProgressOk() (*ListReplaySessions200ResponseItemsInnerProgress, bool)`

GetProgressOk returns a tuple with the Progress field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProgress

`func (o *ReplaySession) SetProgress(v ListReplaySessions200ResponseItemsInnerProgress)`

SetProgress sets Progress field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



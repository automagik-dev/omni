# ListDeadLetters200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Dead letter UUID | 
**EventId** | **string** | Original event UUID | 
**EventType** | **string** | Event type | 
**Status** | **string** | Status | 
**ErrorMessage** | **string** | Error message | 
**ErrorStack** | **NullableString** | Error stack trace | 
**RetryCount** | **int32** | Retry attempts | 
**LastRetryAt** | **NullableTime** | Last retry timestamp | 
**ResolvedAt** | **NullableTime** | Resolution timestamp | 
**ResolutionNote** | **NullableString** | Resolution note | 
**CreatedAt** | **time.Time** | Creation timestamp | 

## Methods

### NewListDeadLetters200ResponseItemsInner

`func NewListDeadLetters200ResponseItemsInner(id string, eventId string, eventType string, status string, errorMessage string, errorStack NullableString, retryCount int32, lastRetryAt NullableTime, resolvedAt NullableTime, resolutionNote NullableString, createdAt time.Time, ) *ListDeadLetters200ResponseItemsInner`

NewListDeadLetters200ResponseItemsInner instantiates a new ListDeadLetters200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListDeadLetters200ResponseItemsInnerWithDefaults

`func NewListDeadLetters200ResponseItemsInnerWithDefaults() *ListDeadLetters200ResponseItemsInner`

NewListDeadLetters200ResponseItemsInnerWithDefaults instantiates a new ListDeadLetters200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListDeadLetters200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListDeadLetters200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListDeadLetters200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetEventId

`func (o *ListDeadLetters200ResponseItemsInner) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *ListDeadLetters200ResponseItemsInner) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *ListDeadLetters200ResponseItemsInner) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetEventType

`func (o *ListDeadLetters200ResponseItemsInner) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *ListDeadLetters200ResponseItemsInner) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *ListDeadLetters200ResponseItemsInner) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetStatus

`func (o *ListDeadLetters200ResponseItemsInner) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ListDeadLetters200ResponseItemsInner) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ListDeadLetters200ResponseItemsInner) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetErrorMessage

`func (o *ListDeadLetters200ResponseItemsInner) GetErrorMessage() string`

GetErrorMessage returns the ErrorMessage field if non-nil, zero value otherwise.

### GetErrorMessageOk

`func (o *ListDeadLetters200ResponseItemsInner) GetErrorMessageOk() (*string, bool)`

GetErrorMessageOk returns a tuple with the ErrorMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetErrorMessage

`func (o *ListDeadLetters200ResponseItemsInner) SetErrorMessage(v string)`

SetErrorMessage sets ErrorMessage field to given value.


### GetErrorStack

`func (o *ListDeadLetters200ResponseItemsInner) GetErrorStack() string`

GetErrorStack returns the ErrorStack field if non-nil, zero value otherwise.

### GetErrorStackOk

`func (o *ListDeadLetters200ResponseItemsInner) GetErrorStackOk() (*string, bool)`

GetErrorStackOk returns a tuple with the ErrorStack field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetErrorStack

`func (o *ListDeadLetters200ResponseItemsInner) SetErrorStack(v string)`

SetErrorStack sets ErrorStack field to given value.


### SetErrorStackNil

`func (o *ListDeadLetters200ResponseItemsInner) SetErrorStackNil(b bool)`

 SetErrorStackNil sets the value for ErrorStack to be an explicit nil

### UnsetErrorStack
`func (o *ListDeadLetters200ResponseItemsInner) UnsetErrorStack()`

UnsetErrorStack ensures that no value is present for ErrorStack, not even an explicit nil
### GetRetryCount

`func (o *ListDeadLetters200ResponseItemsInner) GetRetryCount() int32`

GetRetryCount returns the RetryCount field if non-nil, zero value otherwise.

### GetRetryCountOk

`func (o *ListDeadLetters200ResponseItemsInner) GetRetryCountOk() (*int32, bool)`

GetRetryCountOk returns a tuple with the RetryCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryCount

`func (o *ListDeadLetters200ResponseItemsInner) SetRetryCount(v int32)`

SetRetryCount sets RetryCount field to given value.


### GetLastRetryAt

`func (o *ListDeadLetters200ResponseItemsInner) GetLastRetryAt() time.Time`

GetLastRetryAt returns the LastRetryAt field if non-nil, zero value otherwise.

### GetLastRetryAtOk

`func (o *ListDeadLetters200ResponseItemsInner) GetLastRetryAtOk() (*time.Time, bool)`

GetLastRetryAtOk returns a tuple with the LastRetryAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastRetryAt

`func (o *ListDeadLetters200ResponseItemsInner) SetLastRetryAt(v time.Time)`

SetLastRetryAt sets LastRetryAt field to given value.


### SetLastRetryAtNil

`func (o *ListDeadLetters200ResponseItemsInner) SetLastRetryAtNil(b bool)`

 SetLastRetryAtNil sets the value for LastRetryAt to be an explicit nil

### UnsetLastRetryAt
`func (o *ListDeadLetters200ResponseItemsInner) UnsetLastRetryAt()`

UnsetLastRetryAt ensures that no value is present for LastRetryAt, not even an explicit nil
### GetResolvedAt

`func (o *ListDeadLetters200ResponseItemsInner) GetResolvedAt() time.Time`

GetResolvedAt returns the ResolvedAt field if non-nil, zero value otherwise.

### GetResolvedAtOk

`func (o *ListDeadLetters200ResponseItemsInner) GetResolvedAtOk() (*time.Time, bool)`

GetResolvedAtOk returns a tuple with the ResolvedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolvedAt

`func (o *ListDeadLetters200ResponseItemsInner) SetResolvedAt(v time.Time)`

SetResolvedAt sets ResolvedAt field to given value.


### SetResolvedAtNil

`func (o *ListDeadLetters200ResponseItemsInner) SetResolvedAtNil(b bool)`

 SetResolvedAtNil sets the value for ResolvedAt to be an explicit nil

### UnsetResolvedAt
`func (o *ListDeadLetters200ResponseItemsInner) UnsetResolvedAt()`

UnsetResolvedAt ensures that no value is present for ResolvedAt, not even an explicit nil
### GetResolutionNote

`func (o *ListDeadLetters200ResponseItemsInner) GetResolutionNote() string`

GetResolutionNote returns the ResolutionNote field if non-nil, zero value otherwise.

### GetResolutionNoteOk

`func (o *ListDeadLetters200ResponseItemsInner) GetResolutionNoteOk() (*string, bool)`

GetResolutionNoteOk returns a tuple with the ResolutionNote field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolutionNote

`func (o *ListDeadLetters200ResponseItemsInner) SetResolutionNote(v string)`

SetResolutionNote sets ResolutionNote field to given value.


### SetResolutionNoteNil

`func (o *ListDeadLetters200ResponseItemsInner) SetResolutionNoteNil(b bool)`

 SetResolutionNoteNil sets the value for ResolutionNote to be an explicit nil

### UnsetResolutionNote
`func (o *ListDeadLetters200ResponseItemsInner) UnsetResolutionNote()`

UnsetResolutionNote ensures that no value is present for ResolutionNote, not even an explicit nil
### GetCreatedAt

`func (o *ListDeadLetters200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListDeadLetters200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListDeadLetters200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



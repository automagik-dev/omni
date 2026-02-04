# ListEventPayloads200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Payload UUID | 
**EventId** | **string** | Event UUID | 
**Stage** | **string** | Payload stage | 
**MimeType** | **string** | MIME type | 
**SizeBytes** | **int32** | Size in bytes | 
**HasData** | **bool** | Whether data is available | 
**CreatedAt** | **time.Time** | Creation timestamp | 

## Methods

### NewListEventPayloads200ResponseItemsInner

`func NewListEventPayloads200ResponseItemsInner(id string, eventId string, stage string, mimeType string, sizeBytes int32, hasData bool, createdAt time.Time, ) *ListEventPayloads200ResponseItemsInner`

NewListEventPayloads200ResponseItemsInner instantiates a new ListEventPayloads200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListEventPayloads200ResponseItemsInnerWithDefaults

`func NewListEventPayloads200ResponseItemsInnerWithDefaults() *ListEventPayloads200ResponseItemsInner`

NewListEventPayloads200ResponseItemsInnerWithDefaults instantiates a new ListEventPayloads200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListEventPayloads200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListEventPayloads200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListEventPayloads200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetEventId

`func (o *ListEventPayloads200ResponseItemsInner) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *ListEventPayloads200ResponseItemsInner) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *ListEventPayloads200ResponseItemsInner) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetStage

`func (o *ListEventPayloads200ResponseItemsInner) GetStage() string`

GetStage returns the Stage field if non-nil, zero value otherwise.

### GetStageOk

`func (o *ListEventPayloads200ResponseItemsInner) GetStageOk() (*string, bool)`

GetStageOk returns a tuple with the Stage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStage

`func (o *ListEventPayloads200ResponseItemsInner) SetStage(v string)`

SetStage sets Stage field to given value.


### GetMimeType

`func (o *ListEventPayloads200ResponseItemsInner) GetMimeType() string`

GetMimeType returns the MimeType field if non-nil, zero value otherwise.

### GetMimeTypeOk

`func (o *ListEventPayloads200ResponseItemsInner) GetMimeTypeOk() (*string, bool)`

GetMimeTypeOk returns a tuple with the MimeType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMimeType

`func (o *ListEventPayloads200ResponseItemsInner) SetMimeType(v string)`

SetMimeType sets MimeType field to given value.


### GetSizeBytes

`func (o *ListEventPayloads200ResponseItemsInner) GetSizeBytes() int32`

GetSizeBytes returns the SizeBytes field if non-nil, zero value otherwise.

### GetSizeBytesOk

`func (o *ListEventPayloads200ResponseItemsInner) GetSizeBytesOk() (*int32, bool)`

GetSizeBytesOk returns a tuple with the SizeBytes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSizeBytes

`func (o *ListEventPayloads200ResponseItemsInner) SetSizeBytes(v int32)`

SetSizeBytes sets SizeBytes field to given value.


### GetHasData

`func (o *ListEventPayloads200ResponseItemsInner) GetHasData() bool`

GetHasData returns the HasData field if non-nil, zero value otherwise.

### GetHasDataOk

`func (o *ListEventPayloads200ResponseItemsInner) GetHasDataOk() (*bool, bool)`

GetHasDataOk returns a tuple with the HasData field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasData

`func (o *ListEventPayloads200ResponseItemsInner) SetHasData(v bool)`

SetHasData sets HasData field to given value.


### GetCreatedAt

`func (o *ListEventPayloads200ResponseItemsInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *ListEventPayloads200ResponseItemsInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *ListEventPayloads200ResponseItemsInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



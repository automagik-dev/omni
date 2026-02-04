# PayloadMetadata

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

### NewPayloadMetadata

`func NewPayloadMetadata(id string, eventId string, stage string, mimeType string, sizeBytes int32, hasData bool, createdAt time.Time, ) *PayloadMetadata`

NewPayloadMetadata instantiates a new PayloadMetadata object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPayloadMetadataWithDefaults

`func NewPayloadMetadataWithDefaults() *PayloadMetadata`

NewPayloadMetadataWithDefaults instantiates a new PayloadMetadata object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *PayloadMetadata) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *PayloadMetadata) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *PayloadMetadata) SetId(v string)`

SetId sets Id field to given value.


### GetEventId

`func (o *PayloadMetadata) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *PayloadMetadata) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *PayloadMetadata) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetStage

`func (o *PayloadMetadata) GetStage() string`

GetStage returns the Stage field if non-nil, zero value otherwise.

### GetStageOk

`func (o *PayloadMetadata) GetStageOk() (*string, bool)`

GetStageOk returns a tuple with the Stage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStage

`func (o *PayloadMetadata) SetStage(v string)`

SetStage sets Stage field to given value.


### GetMimeType

`func (o *PayloadMetadata) GetMimeType() string`

GetMimeType returns the MimeType field if non-nil, zero value otherwise.

### GetMimeTypeOk

`func (o *PayloadMetadata) GetMimeTypeOk() (*string, bool)`

GetMimeTypeOk returns a tuple with the MimeType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMimeType

`func (o *PayloadMetadata) SetMimeType(v string)`

SetMimeType sets MimeType field to given value.


### GetSizeBytes

`func (o *PayloadMetadata) GetSizeBytes() int32`

GetSizeBytes returns the SizeBytes field if non-nil, zero value otherwise.

### GetSizeBytesOk

`func (o *PayloadMetadata) GetSizeBytesOk() (*int32, bool)`

GetSizeBytesOk returns a tuple with the SizeBytes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSizeBytes

`func (o *PayloadMetadata) SetSizeBytes(v int32)`

SetSizeBytes sets SizeBytes field to given value.


### GetHasData

`func (o *PayloadMetadata) GetHasData() bool`

GetHasData returns the HasData field if non-nil, zero value otherwise.

### GetHasDataOk

`func (o *PayloadMetadata) GetHasDataOk() (*bool, bool)`

GetHasDataOk returns a tuple with the HasData field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasData

`func (o *PayloadMetadata) SetHasData(v bool)`

SetHasData sets HasData field to given value.


### GetCreatedAt

`func (o *PayloadMetadata) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *PayloadMetadata) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *PayloadMetadata) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



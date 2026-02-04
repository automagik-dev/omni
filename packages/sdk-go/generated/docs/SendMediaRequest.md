# SendMediaRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID to send from | 
**To** | **string** | Recipient | 
**Type** | **string** | Media type | 
**Url** | Pointer to **string** | Media URL | [optional] 
**Base64** | Pointer to **string** | Base64 encoded media | [optional] 
**Filename** | Pointer to **string** | Filename for documents | [optional] 
**Caption** | Pointer to **string** | Caption for media | [optional] 
**VoiceNote** | Pointer to **bool** | Send audio as voice note | [optional] 

## Methods

### NewSendMediaRequest

`func NewSendMediaRequest(instanceId string, to string, type_ string, ) *SendMediaRequest`

NewSendMediaRequest instantiates a new SendMediaRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendMediaRequestWithDefaults

`func NewSendMediaRequestWithDefaults() *SendMediaRequest`

NewSendMediaRequestWithDefaults instantiates a new SendMediaRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendMediaRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendMediaRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendMediaRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendMediaRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendMediaRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendMediaRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetType

`func (o *SendMediaRequest) GetType() string`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *SendMediaRequest) GetTypeOk() (*string, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *SendMediaRequest) SetType(v string)`

SetType sets Type field to given value.


### GetUrl

`func (o *SendMediaRequest) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *SendMediaRequest) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *SendMediaRequest) SetUrl(v string)`

SetUrl sets Url field to given value.

### HasUrl

`func (o *SendMediaRequest) HasUrl() bool`

HasUrl returns a boolean if a field has been set.

### GetBase64

`func (o *SendMediaRequest) GetBase64() string`

GetBase64 returns the Base64 field if non-nil, zero value otherwise.

### GetBase64Ok

`func (o *SendMediaRequest) GetBase64Ok() (*string, bool)`

GetBase64Ok returns a tuple with the Base64 field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBase64

`func (o *SendMediaRequest) SetBase64(v string)`

SetBase64 sets Base64 field to given value.

### HasBase64

`func (o *SendMediaRequest) HasBase64() bool`

HasBase64 returns a boolean if a field has been set.

### GetFilename

`func (o *SendMediaRequest) GetFilename() string`

GetFilename returns the Filename field if non-nil, zero value otherwise.

### GetFilenameOk

`func (o *SendMediaRequest) GetFilenameOk() (*string, bool)`

GetFilenameOk returns a tuple with the Filename field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFilename

`func (o *SendMediaRequest) SetFilename(v string)`

SetFilename sets Filename field to given value.

### HasFilename

`func (o *SendMediaRequest) HasFilename() bool`

HasFilename returns a boolean if a field has been set.

### GetCaption

`func (o *SendMediaRequest) GetCaption() string`

GetCaption returns the Caption field if non-nil, zero value otherwise.

### GetCaptionOk

`func (o *SendMediaRequest) GetCaptionOk() (*string, bool)`

GetCaptionOk returns a tuple with the Caption field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCaption

`func (o *SendMediaRequest) SetCaption(v string)`

SetCaption sets Caption field to given value.

### HasCaption

`func (o *SendMediaRequest) HasCaption() bool`

HasCaption returns a boolean if a field has been set.

### GetVoiceNote

`func (o *SendMediaRequest) GetVoiceNote() bool`

GetVoiceNote returns the VoiceNote field if non-nil, zero value otherwise.

### GetVoiceNoteOk

`func (o *SendMediaRequest) GetVoiceNoteOk() (*bool, bool)`

GetVoiceNoteOk returns a tuple with the VoiceNote field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVoiceNote

`func (o *SendMediaRequest) SetVoiceNote(v bool)`

SetVoiceNote sets VoiceNote field to given value.

### HasVoiceNote

`func (o *SendMediaRequest) HasVoiceNote() bool`

HasVoiceNote returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



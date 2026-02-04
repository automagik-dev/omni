# ListEvents200ResponseItemsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Event UUID | 
**EventType** | **string** | Event type | 
**ContentType** | **NullableString** | Content type | 
**InstanceId** | **string** | Instance UUID | 
**PersonId** | **NullableString** | Person UUID | 
**Direction** | **string** | Message direction | 
**TextContent** | **NullableString** | Text content | 
**Transcription** | **NullableString** | Audio transcription | 
**ImageDescription** | **NullableString** | Image description | 
**ReceivedAt** | **time.Time** | When event was received | 
**ProcessedAt** | **NullableTime** | When event was processed | 

## Methods

### NewListEvents200ResponseItemsInner

`func NewListEvents200ResponseItemsInner(id string, eventType string, contentType NullableString, instanceId string, personId NullableString, direction string, textContent NullableString, transcription NullableString, imageDescription NullableString, receivedAt time.Time, processedAt NullableTime, ) *ListEvents200ResponseItemsInner`

NewListEvents200ResponseItemsInner instantiates a new ListEvents200ResponseItemsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListEvents200ResponseItemsInnerWithDefaults

`func NewListEvents200ResponseItemsInnerWithDefaults() *ListEvents200ResponseItemsInner`

NewListEvents200ResponseItemsInnerWithDefaults instantiates a new ListEvents200ResponseItemsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ListEvents200ResponseItemsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ListEvents200ResponseItemsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ListEvents200ResponseItemsInner) SetId(v string)`

SetId sets Id field to given value.


### GetEventType

`func (o *ListEvents200ResponseItemsInner) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *ListEvents200ResponseItemsInner) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *ListEvents200ResponseItemsInner) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetContentType

`func (o *ListEvents200ResponseItemsInner) GetContentType() string`

GetContentType returns the ContentType field if non-nil, zero value otherwise.

### GetContentTypeOk

`func (o *ListEvents200ResponseItemsInner) GetContentTypeOk() (*string, bool)`

GetContentTypeOk returns a tuple with the ContentType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContentType

`func (o *ListEvents200ResponseItemsInner) SetContentType(v string)`

SetContentType sets ContentType field to given value.


### SetContentTypeNil

`func (o *ListEvents200ResponseItemsInner) SetContentTypeNil(b bool)`

 SetContentTypeNil sets the value for ContentType to be an explicit nil

### UnsetContentType
`func (o *ListEvents200ResponseItemsInner) UnsetContentType()`

UnsetContentType ensures that no value is present for ContentType, not even an explicit nil
### GetInstanceId

`func (o *ListEvents200ResponseItemsInner) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *ListEvents200ResponseItemsInner) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *ListEvents200ResponseItemsInner) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetPersonId

`func (o *ListEvents200ResponseItemsInner) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *ListEvents200ResponseItemsInner) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *ListEvents200ResponseItemsInner) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### SetPersonIdNil

`func (o *ListEvents200ResponseItemsInner) SetPersonIdNil(b bool)`

 SetPersonIdNil sets the value for PersonId to be an explicit nil

### UnsetPersonId
`func (o *ListEvents200ResponseItemsInner) UnsetPersonId()`

UnsetPersonId ensures that no value is present for PersonId, not even an explicit nil
### GetDirection

`func (o *ListEvents200ResponseItemsInner) GetDirection() string`

GetDirection returns the Direction field if non-nil, zero value otherwise.

### GetDirectionOk

`func (o *ListEvents200ResponseItemsInner) GetDirectionOk() (*string, bool)`

GetDirectionOk returns a tuple with the Direction field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDirection

`func (o *ListEvents200ResponseItemsInner) SetDirection(v string)`

SetDirection sets Direction field to given value.


### GetTextContent

`func (o *ListEvents200ResponseItemsInner) GetTextContent() string`

GetTextContent returns the TextContent field if non-nil, zero value otherwise.

### GetTextContentOk

`func (o *ListEvents200ResponseItemsInner) GetTextContentOk() (*string, bool)`

GetTextContentOk returns a tuple with the TextContent field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTextContent

`func (o *ListEvents200ResponseItemsInner) SetTextContent(v string)`

SetTextContent sets TextContent field to given value.


### SetTextContentNil

`func (o *ListEvents200ResponseItemsInner) SetTextContentNil(b bool)`

 SetTextContentNil sets the value for TextContent to be an explicit nil

### UnsetTextContent
`func (o *ListEvents200ResponseItemsInner) UnsetTextContent()`

UnsetTextContent ensures that no value is present for TextContent, not even an explicit nil
### GetTranscription

`func (o *ListEvents200ResponseItemsInner) GetTranscription() string`

GetTranscription returns the Transcription field if non-nil, zero value otherwise.

### GetTranscriptionOk

`func (o *ListEvents200ResponseItemsInner) GetTranscriptionOk() (*string, bool)`

GetTranscriptionOk returns a tuple with the Transcription field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTranscription

`func (o *ListEvents200ResponseItemsInner) SetTranscription(v string)`

SetTranscription sets Transcription field to given value.


### SetTranscriptionNil

`func (o *ListEvents200ResponseItemsInner) SetTranscriptionNil(b bool)`

 SetTranscriptionNil sets the value for Transcription to be an explicit nil

### UnsetTranscription
`func (o *ListEvents200ResponseItemsInner) UnsetTranscription()`

UnsetTranscription ensures that no value is present for Transcription, not even an explicit nil
### GetImageDescription

`func (o *ListEvents200ResponseItemsInner) GetImageDescription() string`

GetImageDescription returns the ImageDescription field if non-nil, zero value otherwise.

### GetImageDescriptionOk

`func (o *ListEvents200ResponseItemsInner) GetImageDescriptionOk() (*string, bool)`

GetImageDescriptionOk returns a tuple with the ImageDescription field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetImageDescription

`func (o *ListEvents200ResponseItemsInner) SetImageDescription(v string)`

SetImageDescription sets ImageDescription field to given value.


### SetImageDescriptionNil

`func (o *ListEvents200ResponseItemsInner) SetImageDescriptionNil(b bool)`

 SetImageDescriptionNil sets the value for ImageDescription to be an explicit nil

### UnsetImageDescription
`func (o *ListEvents200ResponseItemsInner) UnsetImageDescription()`

UnsetImageDescription ensures that no value is present for ImageDescription, not even an explicit nil
### GetReceivedAt

`func (o *ListEvents200ResponseItemsInner) GetReceivedAt() time.Time`

GetReceivedAt returns the ReceivedAt field if non-nil, zero value otherwise.

### GetReceivedAtOk

`func (o *ListEvents200ResponseItemsInner) GetReceivedAtOk() (*time.Time, bool)`

GetReceivedAtOk returns a tuple with the ReceivedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReceivedAt

`func (o *ListEvents200ResponseItemsInner) SetReceivedAt(v time.Time)`

SetReceivedAt sets ReceivedAt field to given value.


### GetProcessedAt

`func (o *ListEvents200ResponseItemsInner) GetProcessedAt() time.Time`

GetProcessedAt returns the ProcessedAt field if non-nil, zero value otherwise.

### GetProcessedAtOk

`func (o *ListEvents200ResponseItemsInner) GetProcessedAtOk() (*time.Time, bool)`

GetProcessedAtOk returns a tuple with the ProcessedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProcessedAt

`func (o *ListEvents200ResponseItemsInner) SetProcessedAt(v time.Time)`

SetProcessedAt sets ProcessedAt field to given value.


### SetProcessedAtNil

`func (o *ListEvents200ResponseItemsInner) SetProcessedAtNil(b bool)`

 SetProcessedAtNil sets the value for ProcessedAt to be an explicit nil

### UnsetProcessedAt
`func (o *ListEvents200ResponseItemsInner) UnsetProcessedAt()`

UnsetProcessedAt ensures that no value is present for ProcessedAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



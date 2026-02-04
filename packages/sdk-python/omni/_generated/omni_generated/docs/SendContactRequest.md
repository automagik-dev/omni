# SendContactRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**to** | **str** | Recipient | 
**contact** | [**SendContactRequestContact**](SendContactRequestContact.md) |  | 

## Example

```python
from omni_generated.models.send_contact_request import SendContactRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendContactRequest from a JSON string
send_contact_request_instance = SendContactRequest.from_json(json)
# print the JSON string representation of the object
print(SendContactRequest.to_json())

# convert the object into a dict
send_contact_request_dict = send_contact_request_instance.to_dict()
# create an instance of SendContactRequest from a dict
send_contact_request_from_dict = SendContactRequest.from_dict(send_contact_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


